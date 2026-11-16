import {expect,it,vi} from 'vitest';
import {defaultPersonalWorkspace} from '@ontomato/contracts/personal-workspace';
const mocks=vi.hoisted(()=>({home:vi.fn(),overlay:vi.fn(),save:vi.fn()}));
vi.mock('../../product-assets/store',()=>({personalHome:mocks.home,readProductOverlay:mocks.overlay,saveHomeWorkspace:mocks.save}));
vi.mock('../store',()=>({platformHomeStore:{recentApplications:async()=>[]}}));
vi.mock('../../assistant/store',()=>({assistantStore:{recentConversations:async()=>[]}}));
import {readHome,saveFavorites} from '../service';
it('uses current principal preferences and preserves unrelated overlay selections when updating favorites',async()=>{
  const draft={...defaultPersonalWorkspace(),applicationIds:['old']};
  const overlay={...defaultPersonalWorkspace(),applicationIds:['current'],pinnedObjects:[{className:'Person',primaryKey:'one',title:'Alice'}]};
  mocks.home.mockResolvedValue({id:'home',revision:8,document:{kind:'page',workspace:draft}});
  mocks.overlay.mockResolvedValue({revision:3,workspace:overlay});
  const owner={domainId:'domain',userId:'reader'};
  expect((await readHome(owner)).favorites).toEqual([{kind:'application',id:'current'}]);
  await saveFavorites(owner,[{kind:'application',id:'new'}]);
  expect(mocks.save.mock.calls[0][1]).toMatchObject({applicationIds:['new'],pinnedObjects:overlay.pinnedObjects});
});
