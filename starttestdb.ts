



import {DBManager} from './src';



(async ()=>{
    const mgr = await DBManager.create({
        path:"F:/Sosarciel/TestDB",
        port:5433,
        user: 'postgres',
        database: 'postgres',
        host: 'localhost',
        max: 10,  // 最大连接数
        idleTimeoutMillis: 30000, // 30秒后关闭空闲连接
    });
    const client = await mgr.connect();
    //client.query(`DO $$ BEGIN RAISE EXCEPTION '测试异常输出'; END $$;`);
    try{
        await client.query(`DO $$ BEGIN RAISE NOTICE '测试Notice输出'; END $$;`);
        await client.query(`DO $$ BEGIN RAISE EXCEPTION '测试异常输出'; END $$;`);
    }catch{
        client.release();
    }
})();