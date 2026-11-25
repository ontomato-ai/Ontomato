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
    "framePanelId": "builtin-product-platform-frame",
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
      "permissions": [],
      "panelUses": [{
        "id": "home",
        "pageKey": "home",
        "panelId": "builtin-product-personal-workspace",
        "path": "/home",
        "access": { "kind": "domain-member" },
        "pageComposer": "none",
        "icon": "home",
        "names": {
          "en": "Personal workspace",
          "zh-CN": "个人工作台",
          "zh-TW": "個人工作台",
          "ja": "パーソナルワークスペース",
          "de": "Persönlicher Arbeitsbereich",
          "fr": "Espace personnel",
          "it": "Area personale",
          "ar": "مساحة العمل الشخصية"
        },
        "descriptions": {
          "en": "Your apps, agents, dashboards, tasks and recent work",
          "zh-CN": "常用应用、智能体、仪表盘、任务与最近访问"
        }
      }, {
        "id": "home-object-detail-body",
        "pageKey": "home-object-detail-body",
        "panelId": "builtin-product-object-detail-body",
        "path": "/home/object-detail",
        "access": { "kind": "domain-member" }
      }]
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
    "allowStandalone": false,
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
    "allowStandalone": false,
    "framePanelId": "builtin-product-platform-frame",
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
      "panelUses": [{
        "id": "dashboards-main",
        "pageKey": "dashboards",
        "panelId": "builtin-product-dashboards",
        "path": "/dashboards",
        "access": { "kind": "domain-member" },
        "icon": "dashboards",
        "frameHeader": true,
        "names": {
          "en": "Dashboards",
          "zh-CN": "仪表盘",
          "zh-TW": "儀表板",
          "ja": "ダッシュボード",
          "de": "Dashboards",
          "fr": "Tableaux de bord",
          "it": "Dashboard",
          "ar": "لوحات المعلومات"
        },
        "descriptions": {
          "en": "Build and review dashboards of your charts and metrics",
          "zh-CN": "制作和查看由图表、指标组成的仪表盘",
          "zh-TW": "建立並檢視由圖表與指標組成的儀表板",
          "ja": "チャートと指標のダッシュボードを作成・閲覧します",
          "de": "Erstellen und prüfen Sie Dashboards aus Ihren Diagrammen und Kennzahlen",
          "fr": "Créez et consultez vos tableaux de bord de graphiques et d'indicateurs",
          "it": "Crea e consulta dashboard con i tuoi grafici e indicatori",
          "ar": "أنشئ وراجع لوحات المعلومات الخاصة بالمخططات والمؤشرات"
        }
      }]
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
    "allowStandalone": false,
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
    "framePanelId": "builtin-product-ops-frame",
    "declaration": {
      "names": {
        "en": "Operations diagnosis",
        "zh-CN": "运维诊断",
        "zh-TW": "維運診斷",
        "ja": "運用診断",
        "de": "Betriebsdiagnose",
        "fr": "Diagnostic opérationnel",
        "it": "Diagnostica operativa",
        "ar": "تشخيص العمليات"
      },
      "descriptions": {
        "en": "Diagnose agent and service failures",
        "zh-CN": "诊断智能体与服务故障"
      },
      "icon": "diagnosis",
      "groups": [
        {
          "key": "autotest",
          "sort": 1,
          "names": {
            "en": "Automatic tests",
            "zh-CN": "自动测试",
            "zh-TW": "自動測試",
            "ja": "自動テスト",
            "de": "Automatische Tests",
            "fr": "Tests automatiques",
            "it": "Test automatici",
            "ar": "الاختبارات التلقائية"
          }
        }
      ],
      "permissions": [],
      "panelUses": [{
        "id": "ops-diagnosis",
        "pageKey": "ops-diagnosis",
        "kind": "frame-conversation",
        "path": "/ops/diagnosis",
        "access": { "permissionCode": "observer" }
      }, {
        "id": "ops-turn-evidence",
        "pageKey": "ops-turn-evidence",
        "panelId": "builtin-product-ops-turn-evidence",
        "path": "/ops/turn",
        "access": { "permissionCode": "observer" },
        "defaultAgent": { "kind": "preset", "agentKind": "ops-diagnosis" },
        "icon": "file-search",
        "names": {
          "en": "Turn evidence",
          "zh-CN": "Turn 取证",
          "zh-TW": "Turn 取證",
          "ja": "Turn エビデンス",
          "de": "Turn-Belege",
          "fr": "Preuves de tour",
          "it": "Evidenze turno",
          "ar": "أدلة الجولة"
        },
        "descriptions": {
          "en": "Inspect captured turn evidence workspaces, artifacts, retention, and downloads",
          "zh-CN": "查看已采集的 Turn 取证工作区、产物文件、保留状态与导出下载"
        }
      }, {
        "id": "ops-test-run",
        "pageKey": "ops-test-run",
        "kind": "native",
        "path": "/ops/test",
        "groupKey": "autotest",
        "access": { "permissionCode": "observer" },
        "icon": "flask-conical",
        "names": {
          "en": "Test Execution",
          "zh-CN": "测试执行",
          "zh-TW": "測試執行",
          "ja": "テスト実行",
          "de": "Testausführung",
          "fr": "Exécution des tests",
          "it": "Esecuzione test",
          "ar": "تنفيذ الاختبار"
        },
        "descriptions": {
          "en": "Run automated test suites and follow live execution progress",
          "zh-CN": "执行自动测试批次并实时观察测试进度与日志"
        }
      }, {
        "id": "ops-autotest-results",
        "pageKey": "ops-autotest-results",
        "panelId": "builtin-product-ops-autotest-results",
        "path": "/ops/results",
        "groupKey": "autotest",
        "access": { "permissionCode": "observer" },
        "defaultAgent": { "kind": "preset", "agentKind": "ops-diagnosis" },
        "icon": "flask-conical",
        "inputs": { "caseDetailPath": { "literal": "/ops/autotest/case" } },
        "names": {
          "en": "Test results",
          "zh-CN": "测试结果",
          "zh-TW": "測試結果",
          "ja": "テスト結果",
          "de": "Testergebnisse",
          "fr": "Résultats de test",
          "it": "Risultati test",
          "ar": "نتائج الاختبار"
        },
        "descriptions": {
          "en": "Review autotest runs, accuracy summaries, case verdicts, retention, and downloads",
          "zh-CN": "查看自动测试批次汇总、用例评估结论、保留状态与导出下载"
        }
      }, {
        "id": "ops-autotest-case-artifact",
        "pageKey": "ops-autotest-case-artifact",
        "panelId": "builtin-product-ops-autotest-case-artifact",
        "path": "/ops/autotest/case",
        "groupKey": "autotest",
        "access": { "permissionCode": "observer" },
        "defaultAgent": { "kind": "preset", "agentKind": "ops-diagnosis" }
      }, {
        "id": "ops-autotest-cases",
        "pageKey": "ops-autotest-cases",
        "panelId": "builtin-product-ops-autotest-cases",
        "path": "/ops/cases",
        "groupKey": "autotest",
        "access": { "permissionCode": "observer" },
        "defaultAgent": { "kind": "preset", "agentKind": "ops-diagnosis" },
        "icon": "flask-conical",
        "names": {
          "en": "Test cases",
          "zh-CN": "测试用例",
          "zh-TW": "測試用例",
          "ja": "テストケース",
          "de": "Testfälle",
          "fr": "Cas de test",
          "it": "Casi di test",
          "ar": "حالات الاختبار"
        },
        "descriptions": {
          "en": "Create, import, edit, and delete autotest case sets in form or JSON mode",
          "zh-CN": "新建、导入、表单/JSON 双视图编辑与删除自动测试用例集"
        }
      }, {
        "id": "ops-live-logs",
        "pageKey": "ops-live-logs",
        "kind": "native",
        "path": "/ops/live-logs",
        "access": { "permissionCode": "observer" },
        "icon": "activity",
        "names": {
          "en": "Live logs",
          "zh-CN": "实时日志",
          "zh-TW": "即時日誌",
          "ja": "リアルタイムログ",
          "de": "Live-Protokolle",
          "fr": "Journaux en direct",
          "it": "Log in tempo reale",
          "ar": "السجلات الحية"
        },
        "descriptions": {
          "en": "Stream and inspect live service logs for operations troubleshooting",
          "zh-CN": "实时查看与筛选服务运行日志，辅助排障定位"
        }
      }, {
        "id": "ops-dsl-console",
        "pageKey": "ops-dsl-console",
        "panelId": "builtin-product-ops-dsl-console",
        "path": "/ops/dsl",
        "access": { "permissionCode": "observer" },
        "defaultAgent": { "kind": "preset", "agentKind": "ops-diagnosis" },
        "icon": "square-terminal",
        "names": {
          "en": "DSL execution",
          "zh-CN": "DSL 执行",
          "zh-TW": "DSL 執行",
          "ja": "DSL 実行",
          "de": "DSL-Ausführung",
          "fr": "Exécution DSL",
          "it": "Esecuzione DSL",
          "ar": "تنفيذ DSL"
        },
        "descriptions": {
          "en": "Edit and execute read-only DSL queries against the current domain",
          "zh-CN": "编写并执行当前域的只读 DSL 查询，查看表格与原始响应结果"
        }
      }, {
        "id": "ops-knowledge",
        "pageKey": "ops-knowledge",
        "panelId": "builtin-product-ops-knowledge",
        "path": "/ops/knowledge",
        "access": { "permissionCode": "observer" },
        "defaultAgent": { "kind": "preset", "agentKind": "ops-diagnosis" },
        "icon": "book-open",
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
        "icon": "thumbs-up",
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
    "framePanelId": "builtin-product-platform-frame",
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
      ],
      "panelUses": []
    }
  }
];
