import type { BuiltinApplication } from "@ontomato/contracts/platform-identity";

export const workbenchApplications: BuiltinApplication[] = [
  {
    id: "personal-workspace", kind: "native", rail: "top", sort: 0,
    entry: { path: "/workspace", renderer: "personal-workspace", home: "/workspace" },
    entryAccess: ["domain-member"], scheduleAdapter: null,
    declaration: {
      names: { en: "Personal workspace", "zh-CN": "个人工作台" }, descriptions: {},
      icon: "dashboards", groups: [], permissions: [],
    },
  },
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
  },
  {
    "id": "app-builder",
    "kind": "native",
    "rail": "apps",
    "sort": 40,
    "entry": {
      "path": "/app-builder",
      "renderer": "app-builder",
      "home": "/app-builder"
    },
    "entryAccess": [
      "app-builder"
    ],
    "scheduleAdapter": null,
    "declaration": {
      "names": {
        "en": "App builder",
        "zh-CN": "应用构建"
      },
      "descriptions": {},
      "icon": "builder",
      "groups": [
        {
          "key": "entry",
          "names": {
            "en": "Application entry",
            "zh-CN": "应用入口"
          },
          "sort": 0
        }
      ],
      "permissions": [
        {
          "code": "app-builder",
          "names": {
            "en": "Open application",
            "zh-CN": "打开应用"
          },
          "groupKey": "entry",
          "sort": 0
        }
      ]
    }
  }
];
