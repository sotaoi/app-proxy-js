process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// const scope = {};
// const auxScope = {};

// const { main } = require('@app/proxy/main');
const { aux, reloadAux } = require('@app/proxy/aux');

// setTimeout(() => {
//   main(scope);
// }, 20000);

// main(scope);

aux.run();

setTimeout(() => {
  aux.reload();
}, 5000);
