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

-- drop触发器
CREATE OR REPLACE FUNCTION
public.drop_all_trigger(table_name text)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
    trg RECORD;
    -- 1. 安全转换：若表不存在返回 NULL，避免抛出异常中断事务
    qualified_table regclass := to_regclass(table_name);
    funcs_to_check OID[];
    f_oid OID;
    ref_count INT;
BEGIN
    -- 如果表根本不存在，直接安全退出
    IF qualified_table IS NULL THEN
        RETURN;
    END IF;

    -- 2. 记录当前表所有触发器所依赖的函数 OID
    SELECT array_agg(DISTINCT tgfoid)
    INTO funcs_to_check
    FROM pg_trigger
    WHERE tgrelid = qualified_table
        AND NOT tgisinternal;

    -- 3. 仅删除当前表上的触发器（使用 qualified_table 自动获得安全的转义表名）
    FOR trg IN
        SELECT tgname
        FROM pg_trigger
        WHERE tgrelid = qualified_table
            AND NOT tgisinternal
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON %s;', trg.tgname, qualified_table);
    END LOOP;

    -- 4. 清理作为“组成部分”的函数（孤儿检测）
    IF funcs_to_check IS NOT NULL THEN
        FOREACH f_oid IN ARRAY funcs_to_check
        LOOP
            -- 检查全库是否还有其他表的非内部触发器在引用这个函数
            SELECT count(*)
            INTO ref_count
            FROM pg_trigger
            WHERE tgfoid = f_oid
                AND NOT tgisinternal;

            -- 如果没有任何触发器在用了，说明它彻底成了孤儿，立即安全销毁！
            IF ref_count = 0 THEN
                EXECUTE format('DROP FUNCTION IF EXISTS %s RESTRICT;', f_oid::regprocedure);
            END IF;
        END LOOP;
    END IF;
END;
$$;

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

-- 与js端相等的stringify
DROP FUNCTION IF EXISTS public.canonical_jsonb_text;
CREATE OR REPLACE FUNCTION public.canonical_jsonb_text(j jsonb)
RETURNS text AS $$
DECLARE
    key text;
    val jsonb;
    parts text[] := '{}'::text[];
BEGIN
    IF jsonb_typeof(j) = 'object' THEN
        -- 使用 COLLATE "C" 确保按照字节 (ASCII) 排序，对齐 JS 的 sort()
        FOR key, val IN SELECT d.key, d.value FROM jsonb_each(j) d ORDER BY d.key COLLATE "C" LOOP
            parts := array_append(parts, to_jsonb(key)::text || ':' || public.canonical_jsonb_text(val));
        END LOOP;
        RETURN '{' || array_to_string(parts, ',') || '}';
    ELSIF jsonb_typeof(j) = 'array' THEN
        FOR val IN SELECT * FROM jsonb_array_elements(j) LOOP
            parts := array_append(parts, public.canonical_jsonb_text(val));
        END LOOP;
        RETURN '[' || array_to_string(parts, ',') || ']';
    ELSE
        -- 处理字符串、数字、布尔值 (自带的 ::text 转换已经完美契合 JS 格式)
        RETURN j::text;
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 稳定的hash计算函数
DROP FUNCTION IF EXISTS public.stable_jsonb_hash;
CREATE OR REPLACE FUNCTION public.stable_jsonb_hash(j jsonb)
RETURNS text AS $$
BEGIN
    RETURN md5(public.canonical_jsonb_text(j));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

