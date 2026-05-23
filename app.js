/**
 * app.js -- Entry point. Initialises each feature module.
 * All logic lives in src/.
 */
import { init as initRepeaters   } from './src/repeaters.js';
import { init as initCoverage    } from './src/coverage.js';
import { init as initMapLayers   } from './src/mapLayers.js';
import { init as initOptimizer   } from './src/optimizerUI.js';
import { init as initConfig      } from './src/config.js';
import { init as initDevConsole  } from './src/devConsole.js';
import { init as initPresets     } from './src/presets.js';
import { init as initP2P         } from './src/p2p.js';

initRepeaters();
initConfig();
initCoverage();
initMapLayers();
initOptimizer();
initDevConsole();
initP2P();
await initPresets(); // async — populates selects from presets.yaml via IPC
