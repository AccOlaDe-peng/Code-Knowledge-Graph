<template>
  <div class="main-layout">
    <header class="app-header">
      <Header />
    </header>
    <div class="app-body">
      <nav class="app-sidebar">
        <Sidebar />
      </nav>
      <main class="app-main">
        <router-view />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import Header from '../components/Header.vue'
import Sidebar from '../components/Sidebar.vue'
</script>

<style scoped>
.main-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg-base);
  overflow: hidden;
}

.app-header {
  height: var(--header-height);
  flex-shrink: 0;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-default);
  z-index: 100;
}

.app-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.app-sidebar {
  width: var(--sidebar-width);
  flex-shrink: 0;
  background: var(--bg-surface);
  border-right: 1px solid var(--border-default);
  overflow-y: auto;
  overflow-x: hidden;
}

.app-main {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  background: var(--bg-base);
  padding: 28px 32px;
}
</style>
