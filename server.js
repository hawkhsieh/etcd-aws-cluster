// Copyright (c) 2016, David M. Lee, II

require('babel-register')({
  retainLines: typeof v8debug !== 'undefined',
});
require('./src');
