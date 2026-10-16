import { createRouter, createWebHashHistory } from 'vue-router';
import Lobby from './views/Lobby.vue';
import Table from './views/Table.vue';
import History from './views/History.vue';
import Replay from './views/Replay.vue';
import Rank from './views/Rank.vue';

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'lobby', component: Lobby },
    { path: '/table', name: 'table', component: Table },
    { path: '/history', name: 'history', component: History },
    { path: '/replay', name: 'replay', component: Replay },
    { path: '/rank', name: 'rank', component: Rank },
  ],
});
