#!/usr/bin/env node
/**
 *
 * The Bipio API Server
 *
 * Copyright (c) 2017 InterDigital, Inc. All Rights Reserved
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 *
 * A Bipio Commercial OEM License may be obtained via hello@bip.io
 */
/**
 * Installs the singletons for a pod against accounts which do not currently
 * have it installed.
 */
process.HEADLESS = true;
var program = require('commander'),
    fs = require('fs'),
    path = require('path'),
    os = require('os'),
    helper = require('../src/lib/helper'),
    bootstrap = require(__dirname + '/../src/bootstrap');

program
    .version('0.0.1')
    .option('-a, --add [name]', 'Initialize a new Pod for this environment')
    .option('-r, --remove [name]', 'Drops a Pod from this environment (+destroys config)')
    .option('-c, --corpus', 'Update system transform corpus')
    .option('-u, --upgrade', 'Upgrade Host Cluster. Auto installs singletons **experimental, still requires a restart')
    // .option('-i, --interactive', 'Interactive Config, sets config values now')
    .parse(process.argv);

if (program.add && program.remove) {
    console.log('Can not --add and --remove in the same step');
    program.help();
} else if (!program.add && !program.remove) {
    program.help();
}

var mode, podName;

if (program.add) {
    mode = 'add';
    podName = program.add;
} else if (program.remove) {
    mode = 'remove';
    podName = program.remove;
}

function modulePath(name) {
    var podPath = require.resolve(name);
    var node_modules = podPath.split(name).slice(0, -1).join(name);
    return path.join(node_modules, name);
}

try {
    pod = require("bip-pod-" + podName);
    podPath = modulePath("bip-pod-" + podName);
} catch (Err) {
    console.log(Err.toString());
    console.log('Trying literal module name...');
    pod = require(podName);
    podPath = modulePath(podName);
}

if (pod && podPath) {

    pod.init(
      podName,
      bootstrap.app.dao,
      bootstrap.app.modules.cdn,
      bootstrap.app.logmessage,
      {
        blacklist : CFG.server.public_interfaces,
        baseUrl : bootstrap.app.dao.getBaseUrl(),
        cdnPublicBaseURL : CFG.cdn_public,
        cdnBasePath : 'cdn',
        emitterBaseURL :  (CFG.site_emitter || CFG.website_public) + '/emitter',
        timezone : CFG.timezone,
        isMaster : false
      }
    );

    podName = pod.getName();

    var configFile = GLOBAL.CFG.getConfigSources()[0].name,
      corpusFile = path.join(podPath, 'corpus.json');

    console.log('Installing "' + podName + '" POD');

    // load local
    var currentConfig = JSON.parse(fs.readFileSync(configFile)),
    config = pod.getConfig() || {};

    if (currentConfig) {
        var imgDir = GLOBAL.CFG.modules.cdn.config.data_dir + "/perm/cdn/img/pods";
        if (!fs.existsSync(imgDir)) {
            helper.mkdir_p(imgDir);

            // just block the process.
            require('sleep').sleep(2);
                        console.log(' created ' + imgDir);
        }

        var actionDone = false;
        if (mode === 'add' && !currentConfig.pods[podName]) {
            currentConfig.pods[podName] = config;
            /*
            if (config.oauth && config.oauth.callbackURL) {
              currentConfig.pods[podName].oauth.callbackURL = currentConfig.proto_public
                + currentConfig.domain_public
                + config.oauth.callbackURL;
            }
            */
            actionDone = true;

        } else if (mode === 'remove' && currentConfig.pods[podName]) {
            delete currentConfig.pods[podName];
            actionDone = true;
        }

        if (actionDone) {
            fs.writeFileSync(configFile, JSON.stringify(currentConfig, null, 4));
            console.log('Wrote to ' + configFile);
        } else {
            console.log('Skipped write. Nothing to change');
            var podIcon = path.join(podPath, podName + '.png');
            if (fs.existsSync(podIcon)) {
                fs.createReadStream(podIcon).pipe(fs.createWriteStream(path.join(imgDir, podName + '.png')));
                console.log('Icon Synced');
            }
        }

        if (program.upgrade) {
            if (mode !== 'remove') {
                console.log('Upgrading Cluster on ' + os.hostname());
                var podContext = bootstrap.app.dao.pod(podName);

                module.exports.app = app;

                bootstrap.app.bastion.on('readyQueue', function(readyQueue) {
                    if (readyQueue == 'queue_jobs') {
                        app.logmessage('Queue is up [queue_jobs]');

                        // get all users
                        bootstrap.app.dao.findFilter('account', {}, function(err, accounts) {
                            if (err) {
                                console.log(err);
                                process.exit(0);
                            } else {
                                if (accounts.length > 0) {
                                    for (var j = 0; j < accounts.length; j++) {
                                        account = accounts[j];
                                        // install singletons
                                        podContext.autoInstall(account, function(err, result) {
                                            if (err) {
                                                app.logmessage(result, 'error');
                                            } else {
                                                console.log('installed ' + result + ' into ' + result.owner_id);
                                            }

                                            if (j >= accounts.length - 1) {
                                                process.exit(0);
                                            }
                                        });


                                    }
                                } else {
                                    app.logmessage('No Accounts!', 'error');
                                    process.exit(0);

                                }
                            }
                        });

                    }
                });
            }
        } else {
          console.log('DONE!');
          if (config.oauth) {
            console.log('*** Manual OAuth Setup Required - update the pods.' + podName + '.oauth section of ' + configFile + ' with your app credentials before restart');

          } else if (config.api_key) {
            console.log('*** Manual API Key Setup Required - update the pods.' + podName + '.api_key section of ' + configFile + ' with your app API key before restart');
          } else {
            console.log('Please restart the server at your convenience');
          }
          process.exit(0);
        }

    }
} else {
    console.log('Pod not found, no config or pod object has no name');
    process.exit(0);
}
