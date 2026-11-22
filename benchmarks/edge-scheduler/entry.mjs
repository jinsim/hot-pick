import {dispatch} from '../../monitoring/health/scheduler.mjs';
export default {async fetch(request){try{const result=await dispatch({HOT_PICK_DISPATCH_TOKEN:'edge-runtime-test-placeholder'},(_url,init)=>fetch('http://127.0.0.1:8841'+new URL(request.url).pathname,init));return Response.json(result);}catch(e){return Response.json({rejected:true,message:e.message},{status:502});}}};
