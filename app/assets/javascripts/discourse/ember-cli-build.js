"use strict";

const EmberApp = require("ember-cli/lib/broccoli/ember-app");
const resolve = require("path").resolve;
const mergeTrees = require("broccoli-merge-trees");
const concat = require("broccoli-concat");
const prettyTextEngine = require("./lib/pretty-text-engine");
const { createI18nTree } = require("./lib/translation-plugin");
const { parsePluginClientSettings } = require("./lib/site-settings-plugin");
const discourseScss = require("./lib/discourse-scss");
const generateScriptsTree = require("./lib/scripts");
const funnel = require("broccoli-funnel");
const DeprecationSilencer = require("./lib/deprecation-silencer");

module.exports = function (defaults) {
  let discourseRoot = resolve("../../../..");
  let vendorJs = discourseRoot + "/vendor/assets/javascripts/";

  // Silence deprecations which we are aware of - see `lib/deprecation-silencer.js`
  const ui = defaults.project.ui;
  DeprecationSilencer.silenceUiWarn(ui);
  DeprecationSilencer.silenceConsoleWarn();

  const isProduction = EmberApp.env().includes("production");
  const isTest = EmberApp.env().includes("test");

  const webpackConfig = {
    // Workarounds for https://github.com/ef4/ember-auto-import/issues/519 and https://github.com/ef4/ember-auto-import/issues/478
    devtool: isProduction ? false : "source-map", // Sourcemaps contain reference to the ephemeral broccoli cache dir, which changes on every deploy
    optimization: {
      moduleIds: "size", // Consistent module references https://github.com/ef4/ember-auto-import/issues/478#issuecomment-1000526638
    },
    resolve: {
      alias: {
        /**
         * This doesn't actually alias the code, but allows webpack to think virtual-dom exists.
         * We've defined an AMD/requirejs entrypoint that defines virtual-dom, and points at @discourse/virtual-dom
         */
        // "virtual-dom": "@discourse/virtual-dom",
        // "@discourse/virtual-dom": "@discourse/virtual-dom",
      },
      fallback: {
        // Sinon needs a `util` polyfill
        util: require.resolve("util/"),
      },
    },
    module: {
      rules: [
        // Sinon/`util` polyfill accesses the `process` global,
        // so we need to provide a mock
        {
          test: require.resolve("util/"),
          use: [
            {
              loader: "imports-loader",
              options: {
                additionalCode: "var process = { env: {} };",
              },
            },
          ],
        },
      ],
    },
  };

  let app = new EmberApp(defaults, {
    autoRun: false,
    "ember-qunit": {
      insertContentForTestBody: false,
    },
    sourcemaps: {
      // There seems to be a bug with broccoli-concat when sourcemaps are disabled
      // that causes the `app.import` statements below to fail in production mode.
      // This forces the use of `fast-sourcemap-concat` which works in production.
      enabled: true,
    },
    autoImport: {
      alias: {
        // "virtual-dom": "@discourse/virtual-dom",
      },
      forbidEval: true,
      insertScriptsAt: "ember-auto-import-scripts",
      webpack: webpackConfig,
    },
    fingerprint: {
      // Handled by Rails asset pipeline
      enabled: false,
    },
    SRI: {
      // We don't use SRI in Rails. Disable here to match:
      enabled: false,
    },

    "ember-cli-terser": {
      enabled: isProduction,
      exclude: [
        "**/test-*.js",
        "**/core-tests*.js",
        "**/highlightjs/*",
        "**/javascripts/*",
      ],
    },

    "ember-cli-babel": {
      throwUnlessParallelizable: true,
    },

    babel: {
      // plugins: [DeprecationSilencer.generateBabelPlugin()],
    },

    // We need to build tests in prod for theme tests
    // tests: true,
    tests: false,

    vendorFiles: {
      // Freedom patch - includes bug fix and async stack support
      // https://github.com/discourse/backburner.js/commits/discourse-patches
      backburner:
        "node_modules/@discourse/backburner.js/dist/named-amd/backburner.js",
    },
  });

  // Patching a private method is not great, but there's no other way for us to tell
  // Ember CLI that we want the tests alone in a package without helpers/fixtures, since
  // we re-use those in the theme tests.
  app._defaultPackager.packageApplicationTests = function (tree) {
    let appTestTrees = []
      .concat(
        this.packageEmberCliInternalFiles(),
        this.packageTestApplicationConfig(),
        tree
      )
      .filter(Boolean);

    appTestTrees = mergeTrees(appTestTrees, {
      overwrite: true,
      annotation: "TreeMerger (appTestTrees)",
    });

    let tests = concat(appTestTrees, {
      inputFiles: ["**/tests/**/*-test.js"],
      headerFiles: ["vendor/ember-cli/tests-prefix.js"],
      footerFiles: ["vendor/ember-cli/app-config.js"],
      outputFile: "/assets/core-tests.js",
      annotation: "Concat: Core Tests",
      sourceMapConfig: false,
    });

    let testHelpers = concat(appTestTrees, {
      inputFiles: [
        "**/tests/test-boot-ember-cli.js",
        "**/tests/helpers/**/*.js",
        "**/tests/fixtures/**/*.js",
        "**/tests/setup-tests.js",
      ],
      outputFile: "/assets/test-helpers.js",
      annotation: "Concat: Test Helpers",
      sourceMapConfig: false,
    });

    if (isTest) {
      return mergeTrees([
        tests,
        testHelpers,
        discourseScss(`${discourseRoot}/app/assets/stylesheets`, "qunit.scss"),
        discourseScss(
          `${discourseRoot}/app/assets/stylesheets`,
          "qunit-custom.scss"
        ),
      ]);
    } else {
      return mergeTrees([tests, testHelpers]);
    }
  };

  // WARNING: We should only import scripts here if they are not in NPM.
  // For example: our very specific version of bootstrap-modal.
  app.import(vendorJs + "bootbox.js");
  app.import("node_modules/bootstrap/js/modal.js");
  app.import(vendorJs + "caret_position.js");
  app.import("node_modules/ember-source/dist/ember-template-compiler.js", {
    type: "test",
  });
  app.import(discourseRoot + "/app/assets/javascripts/polyfills.js");

  app.import(
    discourseRoot +
      "/app/assets/javascripts/discourse/public/assets/scripts/module-shims.js"
  );

  const discoursePluginsTree = app.project
    .findAddonByName("discourse-plugins")
    .generatePluginsTree();

  const terserPlugin = app.project.findAddonByName("ember-cli-terser");
  const applyTerser = (tree) => terserPlugin.postprocessTree("all", tree);

  const { Webpack } = require("@embroider/webpack");

  // Docs: https://github.com/embroider-build/embroider/
  return require("@embroider/compat").compatBuild(app, Webpack, {
    // General requirements for plugins:
    // - not loaded when they are not needed (admin, wizard, etc)
    // - "safe mode" can help debugging plugin problems by optionally not loading some of these files
    //   - with dynamic imports, this can be an if condition around the dynamic import
    extraPublicTrees: [
      createI18nTree(discourseRoot, vendorJs),
      parsePluginClientSettings(discourseRoot, vendorJs, app),
      funnel(`${discourseRoot}/public/javascripts`, { destDir: "javascripts" }),
      funnel(`${vendorJs}/highlightjs`, {
        files: ["highlight-test-bundle.min.js"],
        destDir: "assets/highlightjs",
      }),
      // TODO: switch to dynamic import?
      // Requirements
      //   - not loaded when a user is not an admin
      //     - route-splitting would help here, but requires all the static flags be enabled
      //
      // Reason this is no longer a custom broccoli tree:
      // Under embroider, all imports must be statically analyzable, and embroider
      // (or rather, the underlying packager (webpack, vite), does not know how to inspect
      //  these sorts of files)
      //
      //   applyTerser(
      //     concat(mergeTrees([app.options.adminTree]), {
      //       inputFiles: ["**/*.js"],
      //       outputFile: `assets/admin.js`,
      //     })
      //   ),

      // TODO: switch to dynamic import?
      // Requirements
      //  - not loaded unless it's needed
      // Causes:
      // BroccoliMergeTrees: Expected Broccoli node, got undefined for inputNodes[0]
      //  wizardTree is undefined
      //
      // Reason this is no longer a custom broccoli tree:
      // Under embroider, all imports must be statically analyzable, and embroider
      // (or rather, the underlying packager (webpack, vite), does not know how to inspect
      //  these sorts of files)
      //
      // applyTerser(
      //   concat(mergeTrees([app.options.wizardTree]), {
      //     inputFiles: ["**/*.js"],
      //     outputFile: `assets/wizard.js`,
      //   })
      // ),

      // Causes:
      //  [Embroider:MacrosConfig] cannot read userConfigs until MacrosConfig has been finalized.
      //
      // applyTerser(prettyTextEngine(app)),
      generateScriptsTree(app),
      applyTerser(discoursePluginsTree),
    ],
    // staticAddonTestSupportTrees: true,
    // staticAddonTrees: true,
    // staticHelpers: true,
    // staticModifiers: true,
    // staticComponents: true,
    // splitAtRoutes: ["route.name"], // can also be a RegExp
    packagerOptions: {
      // publicAssetURL: '...',
      webpackConfig,
    },
  });
};
