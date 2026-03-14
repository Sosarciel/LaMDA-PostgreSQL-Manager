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

