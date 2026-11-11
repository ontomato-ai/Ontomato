import type { BuiltinApplication } from "@ontomato/contracts/platform-identity";

export const workbenchApplications: BuiltinApplication[] = [
  {
    "id": "home",
    "kind": "native",
    "rail": "top",
    "category": "business",
    "sort": 0,
    "entry": {
      "path": "/home",
      "renderer": "home",
      "home": "/home"
    },
    "entryAccess": [
      "domain-member"
    ],
    "scheduleAdapter": null,
    "declaration": {
      "names": {
        "en": "Home",
        "zh-CN": "主页"
      },
      "descriptions": {
        "en": "Your apps, agents and dashboards",
        "zh-CN": "常用应用、智能体与我的仪表盘"
      },
      "icon": "home",
      "groups": [],
      "permissions": []
    }
  },
  {
    "id": "agents",
    "kind": "native",
    "rail": "top",
    "category": "business",
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
      "descriptions": {
        "en": "Chat with an agent and get answers, analysis and reports from your data",
        "zh-CN": "与智能体对话，基于数据获得回答、分析和报告"
      },
      "icon": "agents",
      "groups": [],
      "permissions": []
    }
  },
  {
    "id": "dashboards",
    "kind": "native",
    "rail": "top",
    "category": "business",
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
      "descriptions": {
        "en": "Build and review dashboards of your charts and metrics",
        "zh-CN": "制作和查看由图表、指标组成的仪表盘"
      },
      "icon": "dashboards",
      "groups": [],
      "permissions": []
    }
  },
  {
    "id": "schedules",
    "kind": "native",
    "rail": "top",
    "category": "business",
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
      "descriptions": {
        "en": "Run analyses and reports on a recurring schedule",
        "zh-CN": "按周期自动运行分析与报告"
      },
      "icon": "schedule",
      "groups": [],
      "permissions": []
    }
  },
  {
    "id": "operations",
    "kind": "native",
    "rail": "apps",
    "category": "admin",
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
      "descriptions": {
        "en": "Diagnose agent and service failures",
        "zh-CN": "诊断智能体与服务故障"
      },
      "icon": "diagnosis",
      "groups": [],
      "permissions": []
    }
  },
  {
    "id": "app-builder",
    "kind": "native",
    "rail": "apps",
    "category": "build",
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
      "descriptions": {
        "en": "Build and publish applications from conversations",
        "zh-CN": "通过对话构建并发布应用"
      },
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
