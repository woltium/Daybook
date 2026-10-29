// 不带窗口单独运行后端（给外部 agent 或调试用）：npm run server
import { startServer } from './app.ts';

const { port } = await startServer(Number(process.env.HUB_API_PORT ?? 5179));
console.log(`Daybook 后端：http://127.0.0.1:${port}  ·  工具列表：/api/tools`);
