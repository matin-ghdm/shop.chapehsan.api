const {test}=require('node:test'),assert=require('node:assert/strict');
test('gateway IP rejection is reported clearly without exposing server details to customers',async()=>{
 const originalFetch=global.fetch,originalCallback=process.env.ZIBAL_CALLBACK_URL;
 process.env.ZIBAL_CALLBACK_URL='https://www.chapehsan.com/api/payments/zibal/callback';
 global.fetch=async()=>({json:async()=>({result:115,message:'invalid IP 74.220.48.20'})});
 try {await assert.rejects(require('../src/services/zibal').requestPayment({amountToman:380000,orderId:'test'}),error=>error.status===503 && error.code==='PAYMENT_CONFIG' && !error.message.includes('74.220.48.20'));}
 finally{global.fetch=originalFetch;if(originalCallback===undefined)delete process.env.ZIBAL_CALLBACK_URL;else process.env.ZIBAL_CALLBACK_URL=originalCallback;}
});
