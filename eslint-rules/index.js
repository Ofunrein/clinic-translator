"use strict";

const noPhiLog = require("./no-phi-log");

/** @type {import('eslint').ESLint.Plugin} */
const plugin = {
  rules: {
    "no-phi-log": noPhiLog,
  },
};

module.exports = plugin;
