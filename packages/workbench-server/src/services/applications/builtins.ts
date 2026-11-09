import type { BuiltinApplication } from "@ontomato/contracts/platform-identity";

export const workbenchApplications: BuiltinApplication[] = [
  {
    "id": "agents",
    "kind": "native",
    "rail": "top",
    "sort": 10,
    "entry": {
      "path": "/agents",
      "renderer": "agents",
      "home": "/agents/chat"
    },
    "entryAccess": [
      "domain-member"
    ],
    "scheduleAdapter": "java:agents",
    "declaration": {
      "names": {
        "en": "Agent platform",
        "zh-CN": "智能体平台"
      },
      "descriptions": {},
      "icon": "agents",
      "groups": [],
      "permissions": []
    }
  },
  {
    "id": "dashboards",
    "kind": "native",
    "rail": "top",
    "sort": 20,
    "entry": {
      "path": "/dashboards",
      "renderer": "dashboards",
      "home": "/dashboards"
    },
    "entryAccess": [
      "domain-member"
    ],
    "scheduleAdapter": null,
    "declaration": {
      "names": {
        "en": "Dashboards",
        "zh-CN": "仪表盘"
      },
      "descriptions": {},
      "icon": "dashboards",
      "groups": [],
      "permissions": []
    }
  },
  {
    "id": "schedules",
    "kind": "native",
    "rail": "top",
    "sort": 30,
    "entry": {
      "path": "/schedules",
      "renderer": "schedules",
      "home": "/schedules"
    },
    "entryAccess": [
      "domain-member"
    ],
    "scheduleAdapter": null,
    "declaration": {
      "names": {
        "en": "Scheduled tasks",
        "zh-CN": "定时任务"
      },
      "descriptions": {},
      "icon": "schedule",
      "groups": [],
      "permissions": []
    }
  },
  {
    "id": "operations",
    "kind": "native",
    "rail": "apps",
    "sort": 30,
    "entry": {
      "path": "/ops",
      "renderer": "operations"
    },
    "entryAccess": [
      "observer"
    ],
    "scheduleAdapter": "workbench:operations",
    "declaration": {
      "names": {
        "en": "Operations diagnosis",
        "zh-CN": "运维诊断"
      },
      "descriptions": {},
      "icon": "diagnosis",
      "groups": [],
      "permissions": []
    }
  }
];
