import type { BuiltinApplication } from "@ontomato/contracts/platform-identity";

export const workbenchApplications: BuiltinApplication[] = [
  {
    id: "application-gallery", kind: "native", rail: "top", category: "business", sort: 2,
    entry: { path: "/applications", renderer: "application-gallery", home: "/applications" },
    entryAccess: ["domain-member"], scheduleAdapter: null, allowStandalone: false,
    framePanelId: "builtin-product-platform-frame",
    declaration: {
      names: { en: "Application gallery", "zh-CN": "应用广场" },
      descriptions: { en: "Discover applications and pin shortcuts to your personal workspace", "zh-CN": "发现应用，并将常用入口固定到个人工作台" },
      icon: "gallery", groups: [], permissions: [],
      panelUses: [{
        id: "application-gallery",
        pageKey: "application-gallery",
        panelId: "builtin-product-application-gallery",
        path: "/applications",
        access: { kind: "domain-member" },
        icon: "gallery",
        names: {
          en: "Application gallery",
          "zh-CN": "应用广场",
          "zh-TW": "應用廣場",
          ja: "アプリギャラリー",
          de: "Anwendungsgalerie",
          fr: "Galerie d'applications",
          it: "Galleria applicazioni",
          ar: "معرض التطبيقات",
        },
        descriptions: {
          en: "Discover applications and pin shortcuts to your personal workspace",
          "zh-CN": "发现应用，并将常用入口固定到个人工作台",
        },
      }],
    },
  },
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
    "allowStandalone": false,
    "declaration": {
      "names": {
        "en": "Personal workspace",
        "zh-CN": "个人工作台"
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
      "domain-member",
      "analysis-agent"
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
      "permissions": [],
      "panelUses": [{
        "id": "agents-agent-settings",
        "pageKey": "agents-agent-settings",
        "panelId": "builtin-product-agent-settings",
        "path": "/agents/settings",
        "access": { "permissionCode": "analysis-agent" },
        "inputs": { "detailPath": { "literal": "/agents/settings/detail" } },
      }, {
        "id": "agents-agent-detail",
        "pageKey": "agents-agent-detail",
        "panelId": "builtin-product-agent-detail",
        "path": "/agents/settings/detail",
        "access": { "permissionCode": "analysis-agent" },
        "inputs": { "catalogPath": { "literal": "/agents/settings" } },
      }],
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
      "permissions": [],
      "pageSkills": [{access:"domain-member",pageKey:"dashboard",skill:{namespace:{kind:"provider",provider:"workbench"},name:"dashboard-pages"}}]
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
    "framePanelId": "builtin-product-platform-frame",
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
      "permissions": [],
      "panelUses": [{
        "id": "schedules-tasks",
        "pageKey": "schedules",
        "panelId": "builtin-product-scheduled-tasks",
        "path": "/schedules",
        "access": { "kind": "domain-member" },
        "icon": "schedule",
        "inputs": { "schedulesApplication": { "literal": { "className": "platform:Application", "primaryKey": "schedules" } } },
        "names": {
          "en": "Scheduled tasks",
          "zh-CN": "定时任务",
          "zh-TW": "排程任務",
          "ja": "定期タスク",
          "de": "Geplante Aufgaben",
          "fr": "Tâches planifiées",
          "it": "Attività pianificate",
          "ar": "المهام المجدولة"
        },
        "descriptions": {
          "en": "Schedule application tasks and review their execution history",
          "zh-CN": "配置各应用的定时任务，查看执行记录与结果"
        }
      }]
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
      "observer",
      "user-feedback"
    ],
    "scheduleAdapter": "workbench:operations",
    "allowStandalone": false,
    "framePanelId": "builtin-product-platform-frame",
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
      "permissions": [],
      "panelUses": [{
        "id": "ops-knowledge",
        "pageKey": "ops-knowledge",
        "panelId": "builtin-product-ops-knowledge",
        "path": "/ops/knowledge",
        "access": { "permissionCode": "observer" },
        "icon": "knowledge",
        "names": {
          "en": "Operations knowledge",
          "zh-CN": "运维知识",
          "zh-TW": "維運知識",
          "ja": "運用ナレッジ",
          "de": "Betriebswissen",
          "fr": "Connaissances d'exploitation",
          "it": "Conoscenze operative",
          "ar": "معرفة التشغيل"
        },
        "descriptions": {
          "en": "Browse operations diagnosis knowledge documents and cross-document references",
          "zh-CN": "浏览运维诊断知识文档与文内关联说明"
        }
      }, {
        "id": "user-feedback",
        "pageKey": "user-feedback",
        "panelId": "builtin-product-feedback",
        "path": "/ops/feedback",
        "access": { "permissionCode": "user-feedback" },
        "icon": "clipboard-list",
        "names": {
          "en": "User feedback",
          "zh-CN": "用户反馈",
          "zh-TW": "使用者回饋",
          "ja": "ユーザーフィードバック",
          "de": "Nutzerfeedback",
          "fr": "Retours des utilisateurs",
          "it": "Feedback degli utenti",
          "ar": "ملاحظات المستخدمين"
        },
        "descriptions": {
          "en": "Ratings and comments users give on query and analysis results",
          "zh-CN": "用户对问答与分析结果的评价和留言"
        }
      }]
    }
  },
  {
    "id": "app-builder",
    "kind": "native",
    "rail": "apps",
    "category": "build",
    "sort": 1,
    "entry": {
      "path": "/app-builder",
      "renderer": "app-builder",
      "home": "/app-builder"
    },
    "entryAccess": [
      "app-builder"
    ],
    "scheduleAdapter": null,
    "allowStandalone": false,
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
