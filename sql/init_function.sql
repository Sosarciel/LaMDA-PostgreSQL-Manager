-- 类型验证
CREATE OR REPLACE FUNCTION
check_jsonb_string(js jsonb, key text)
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

-- drop触发器
CREATE OR REPLACE FUNCTION
drop_all_trigger(table_name text)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
    trg RECORD;
    qualified_table regclass := table_name::regclass;
BEGIN
    FOR trg IN
        SELECT tgname, tgfoid::regprocedure AS func_name
        FROM pg_trigger
        WHERE tgrelid = qualified_table
            AND NOT tgisinternal
    LOOP
        -- 删除触发器
        EXECUTE format('DROP TRIGGER %I ON %s;', trg.tgname, table_name);

        -- 删除绑定函数（注意：需要 schema 限定）
        EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE;', trg.func_name);
    END LOOP;
END;
$$;

-- 索引判断
CREATE OR REPLACE FUNCTION
index_exists(index_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE indexname = index_name
    );
END;
$$;

-- 合并并清洗jsonb
DROP FUNCTION IF EXISTS jsonb_merge_and_clean;
CREATE OR REPLACE FUNCTION
jsonb_merge_and_clean(
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


