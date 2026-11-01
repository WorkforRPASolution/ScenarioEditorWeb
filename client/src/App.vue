<script setup>
// shell-modified: WebManager@2f1eb0a client/src/App.vue — Auth·Landing 레이아웃과 접근 로그(useAccessLogger)를 뺐다. 늘 DefaultLayout.
import DefaultLayout from './layouts/DefaultLayout.vue'
</script>

<template>
  <DefaultLayout>
    <router-view v-slot="{ Component, route }">
      <keep-alive :max="10">
        <component :is="Component" :key="route.path" />
      </keep-alive>
    </router-view>
  </DefaultLayout>
</template>
