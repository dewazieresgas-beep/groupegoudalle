#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');

const files = [
  'server/server.js',
  'js/api.js',
  'js/utils.js'
];

let completed = 0;
let errors = [];

files.forEach(file => {
  const proc = spawn('node', ['--check', file], {
    cwd: __dirname,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';

  proc.stdout.on('data', (data) => { stdout += data; });
  proc.stderr.on('data', (data) => { stderr += data; });

  proc.on('close', (code) => {
    if (code !== 0) {
      errors.push(`✗ ${file} ERREUR\n${stderr}`);
    } else {
      console.log(`✓ ${file} OK`);
    }
    completed++;
    if (completed === files.length) {
      if (errors.length > 0) {
        errors.forEach(err => console.log(err));
        process.exit(1);
      } else {
        process.exit(0);
      }
    }
  });
});
