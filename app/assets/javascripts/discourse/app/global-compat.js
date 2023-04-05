import widgetHelpers from "discourse-widget-hbs/helpers";
import { importSync } from '@embroider/macros';

// AMD/RequireJS compat imports
// NOTE: importing * disables tree-shaking for these modules
import virtualDom from "@discourse/virtual-dom";
import * as compatBuiltIns from '@ember-compat/tracked-built-ins';
import * as popperCore from '@popperjs/core';

window.__widget_helpers = widgetHelpers;

// TODO: Eliminate this global
window.virtualDom = virtualDom;


/**
  * Until we can compile plugins with webpack, we need a shim in to the old AMD/requirejs world.
  * These are the modules that can be accessed from plugins.
  *
  * Webpack/Vite/etc have their own bundle format, so until we can define each plugin
  * as a separate entrypoint so webpack/vite/etc can resolve dependencies (at all),
  * we need to manually re-create the World of Old
  */
const AMD_PROXIES = {
  '@ember-compat/tracked-built-ins': compatBuiltIns,
  '@popperjs/core': popperCore,
  '@discourse/virtual-dom': { default: virtualDom, __esModule: true },
};

for (let [packageName, module] of Object.entries(AMD_PROXIES)) {
  define(packageName, ["exports"], function (exports) {
    Object.assign(exports, module);
  });
}
