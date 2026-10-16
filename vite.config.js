import {defineConfig,loadEnv} from 'vite';
import react from '@vitejs/plugin-react';
import {loadVisitorConfig} from './server/config.js';
import {createVisitorMiddleware} from './server/local-api.js';
export default defineConfig(async({mode})=>{
  const config=await loadVisitorConfig({...loadEnv(mode,process.cwd(),''),...process.env});
  return {base:'./',define:{'import.meta.env.VISITOR_MODE':JSON.stringify(config.mode)},plugins:[react(),{name:'local-visitor-api',configResolved(resolved){for(const target of [resolved.server,resolved.preview])if(target.host&&!['127.0.0.1','localhost','::1'].includes(target.host))throw new Error('This local log reader must bind only to loopback.');},configureServer(server){server.middlewares.use(createVisitorMiddleware(config));},configurePreviewServer(server){server.middlewares.use(createVisitorMiddleware(config));}}],server:{host:'127.0.0.1',port:5187,strictPort:true},preview:{host:'127.0.0.1',port:4187,strictPort:true}};
});
