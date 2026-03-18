import type { DBClient } from "../Client";
import { SLogger } from "@zwa73/utils";

/**表初始化工具
 * 用于在测试环境中创建表结构、索引、触发器和函数
 */
export class TableInitializer {
    /**初始化表结构
     * @param client 数据库客户端
     * @param tableName 表名
     * @param idField 唯一标识字段名
     */
    static async initTable(client: DBClient, tableName: string, idField: string): Promise<void> {
        try {
            // 先尝试删除表和相关对象
            await client.query(`DROP TABLE IF EXISTS ${tableName};`);
            await client.query(`DROP FUNCTION IF EXISTS func__${tableName}__before_insert_or_update();`);
            await client.query(`DROP FUNCTION IF EXISTS set_${tableName}(text);`);

            // 创建通用函数
            await client.query(`
                -- 类型验证
                CREATE OR REPLACE FUNCTION
                public.check_jsonb_string(js jsonb, key text)
                RETURNS BOOLEAN
                LANGUAGE plpgsql IMMUTABLE AS $$
                BEGIN
                    -- 字段不存在
                    IF NOT (js ? key) THEN
                        RETURN false;
                    END IF;

                    -- 类型不是字符串
                    IF jsonb_typeof(js->key) IS DISTINCT FROM 'string' THEN
                        RETURN false;
                    END IF;

                    -- 字符串为空或全是空格
                    IF trim(js->>key) = '' THEN
                        RETURN false;
                    END IF;

                    -- 通过所有检查
                    RETURN true;
                END;
                $$;
            `);

            await client.query(`
                -- 索引判断
                CREATE OR REPLACE FUNCTION
                public.index_exists(index_name TEXT)
                RETURNS BOOLEAN
                LANGUAGE plpgsql AS $$
                BEGIN
                    RETURN EXISTS (
                        SELECT 1 FROM pg_indexes
                        WHERE indexname = index_name
                    );
                END;
                $$;
            `);

            await client.query(`
                -- 合并并清洗jsonb
                DROP FUNCTION IF EXISTS public.jsonb_merge_and_clean;
                CREATE OR REPLACE FUNCTION
                public.jsonb_merge_and_clean(
                    incoming jsonb,
                    original jsonb DEFAULT '{}'::jsonb
                )
                RETURNS jsonb
                IMMUTABLE
                LANGUAGE plpgsql AS $$
                BEGIN
                    RETURN jsonb_strip_nulls(
                        COALESCE(original, '{}'::jsonb) ||
                        COALESCE(incoming, '{}'::jsonb)
                    );
                END;
                $$;
            `);

            // 共用before触发器
            await client.query(`
                CREATE OR REPLACE FUNCTION func__common__before_insert_or_update()
                RETURNS TRIGGER
                LANGUAGE plpgsql AS $$
                BEGIN
                    IF pg_trigger_depth() = 1 THEN
                        -- 更新 updated_at
                        NEW.data := jsonb_set(NEW.data, '{updated_at}',
                            to_jsonb(CURRENT_TIMESTAMP),true);

                        -- 初始化 created_at
                        IF  TG_OP = 'INSERT' AND
                            NOT NEW.data ? 'created_at'
                        THEN
                            NEW.data := jsonb_set(NEW.data, '{created_at}',
                                to_jsonb(CURRENT_TIMESTAMP),true);
                        END IF;

                        -- 合并清洗
                        IF TG_OP = 'UPDATE' THEN
                            NEW.data := jsonb_merge_and_clean(NEW.data, OLD.data);
                        ELSIF TG_OP = 'INSERT' THEN
                            NEW.data := jsonb_merge_and_clean(NEW.data);
                        END IF;
                    END IF;
                    RETURN NEW;
                END;
                $$;
            `);

            // 共用 after 触发器
            await client.query(`
                CREATE OR REPLACE FUNCTION func__common__after_delete_or_insert_or_update()
                RETURNS trigger
                LANGUAGE plpgsql AS $$
                BEGIN
                    PERFORM pg_notify('operation', json_strip_nulls(json_build_object(
                        'op', LOWER(TG_OP),
                        'table', TG_TABLE_NAME,
                        'old', CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN row_to_json(OLD) ELSE NULL END,
                        'new', CASE WHEN TG_OP IN ('UPDATE', 'INSERT') THEN row_to_json(NEW) ELSE NULL END
                    ))::text);
                    RETURN NULL;
                END;
                $$;
            `);

            // 创建表
            await client.query(`
                CREATE TABLE IF NOT EXISTS ${tableName} (
                    order_id BIGSERIAL PRIMARY KEY NOT NULL,
                    data JSONB NOT NULL
                );
            `);

            // 创建索引
            await client.query(`
                DO $$
                BEGIN
                    IF NOT index_exists('idx__${tableName}__${idField}') THEN
                        CREATE UNIQUE INDEX idx__${tableName}__${idField}
                            ON ${tableName} ((data->>'${idField}'));
                    END IF;
                END
                $$;
            `);

            // 创建触发器函数 - 插入或更新前验证
            await client.query(`
                CREATE FUNCTION func__${tableName}__before_insert_or_update()
                RETURNS TRIGGER
                LANGUAGE plpgsql AS $$
                BEGIN
                    -- 非空验证
                    IF NOT check_jsonb_string(NEW.data, '${idField}') THEN
                        RAISE EXCEPTION '${tableName}.data->>${idField} 不能为空或null';
                    END IF;
                    RETURN NEW;
                END;
                $$;
            `);

            // 绑定触发器
            await client.query(`
                CREATE TRIGGER trg__${tableName}__before_insert_or_update
                BEFORE INSERT OR UPDATE ON ${tableName}
                FOR EACH ROW EXECUTE FUNCTION func__${tableName}__before_insert_or_update();
            `);

            // 创建通用触发器
            await client.query(`
                CREATE TRIGGER trg__common__before_insert_or_update
                BEFORE INSERT OR UPDATE ON ${tableName}
                FOR EACH ROW EXECUTE FUNCTION func__common__before_insert_or_update();
            `);

            await client.query(`
                CREATE TRIGGER trg__common__after_delete_or_insert_or_update
                AFTER DELETE OR INSERT OR UPDATE ON ${tableName}
                FOR EACH ROW EXECUTE FUNCTION func__common__after_delete_or_insert_or_update();
            `);

            // 创建读写函数
            await client.query(`
                CREATE FUNCTION set_${tableName}(jsonstr text)
                RETURNS VOID
                LANGUAGE plpgsql AS $$
                DECLARE
                    incoming jsonb := jsonstr::jsonb;
                BEGIN
                    IF NOT check_jsonb_string(incoming, '${idField}') THEN
                        RAISE EXCEPTION '${idField} 不能为空';
                    END IF;

                    IF EXISTS (
                        SELECT 1 FROM ${tableName}
                        WHERE data->>'${idField}' = incoming->>'${idField}'
                    ) THEN
                        UPDATE ${tableName}
                        SET data = incoming
                        WHERE data->>'${idField}' = incoming->>'${idField}';
                    ELSE
                        INSERT INTO ${tableName} (data)
                        VALUES (incoming);
                    END IF;
                END;
                $$;
            `);

            SLogger.info(`表 ${tableName} 初始化完成`);
        } catch (error) {
            SLogger.error(`表 ${tableName} 初始化失败:`, error);
            throw error;
        }
    }

    /**删除表
     * @param client 数据库客户端
     * @param tableName 表名
     */
    static async dropTable(client: DBClient, tableName: string): Promise<void> {
        try {
            // 表名直接拼接到SQL语句中
            await client.query(`DROP TABLE IF EXISTS ${tableName};`);
            SLogger.info(`表 ${tableName} 删除完成`);
        } catch (error) {
            SLogger.error(`表 ${tableName} 删除失败:`, error);
            throw error;
        }
    }
}