process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { main } = require('@app/proxy/main');
const { aux } = require('@app/proxy/aux');

main.run();
aux.run();

setTimeout(() => {
  main.reload();
}, 10000);
