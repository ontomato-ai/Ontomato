import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { ref } from 'vue';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory, createRouter } from 'vue-router';
import { expect, it, vi } from 'vitest';
import { openApplicationKey, platformApplicationsKey, type PlatformAppDeclaration } from '../apps';
import ApplicationGalleryRoute from '../pages/ApplicationGalleryRoute.vue';

const requests = vi.hoisted(() => ({ apps: vi.fn(), agents: vi.fn(), favorites: vi.fn() }));
vi.mock('../catalog', () => ({ useApplicationCatalog: () => ({ refresh: requests.apps, error: { value: null } }) }));
vi.mock('@ontomato/workbench-ui/features/workbench/assistant-host', () => ({ createAssistantClient: () => ({ listAgents: requests.agents }) }));
vi.mock('../features/home/api', () => ({ readHomeState: requests.favorites, saveFavorites: vi.fn() }));

it('keeps available apps and filters while retrying just the failed agent list', async () => {
  requests.apps.mockResolvedValue(undefined);
  requests.agents.mockRejectedValueOnce(new Error('Agent list unavailable')).mockResolvedValueOnce([]);
  requests.favorites.mockResolvedValue({ favorites: [{ kind: 'application', id: 'orders' }] });
  const applications = ref<PlatformAppDeclaration[]>([{ id: 'orders', label: 'Orders', icon: 'pages', category: 'business', prefix: '/orders' }]);
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] });
  await router.push('/');
  const wrapper = mount(ApplicationGalleryRoute, {
    global: {
      plugins: [router, ElementPlus, createI18n({ legacy: false, locale: 'en', missingWarn: false })],
      provide: { [platformApplicationsKey as symbol]: applications, [openApplicationKey as symbol]: vi.fn() },
    },
  });
  try {
    await flushPromises();
    expect(wrapper.get('.home-tile-name').text()).toBe('Orders');
    expect(wrapper.get('.home-tile-star').attributes('aria-pressed')).toBe('true');
    expect(wrapper.get('.el-alert').text()).toContain('Agent list unavailable');
    await wrapper.get('input').setValue('Orders');
    await wrapper.get('.el-alert button').trigger('click');
    await flushPromises();
    expect(wrapper.find('.el-alert').exists()).toBe(false);
    expect(wrapper.get('input').element.value).toBe('Orders');
    expect(wrapper.get('.home-tile-name').text()).toBe('Orders');
    expect(requests.agents).toHaveBeenCalledTimes(2);
    expect(requests.apps).toHaveBeenCalledTimes(1);
    expect(requests.favorites).toHaveBeenCalledTimes(1);
  } finally {
    wrapper.unmount();
  }
});
