const Module = require('module');
const path = require('path');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'vscode') {
    return require(path.join(__dirname, 'vscode-stub.js'));
  }
  return originalLoad.apply(this, arguments);
};
