import type { ThemeConfig } from "antd";

export const antdTheme: ThemeConfig = {
  token: {
    colorPrimary: "#1f6b52",
    colorInfo: "#2563a6",
    colorSuccess: "#16794e",
    colorWarning: "#ad6800",
    colorError: "#b42318",
    colorText: "#18201d",
    colorTextSecondary: "#5f6b66",
    colorBgLayout: "#f4f6f5",
    colorBorderSecondary: "#e4e8e6",
    borderRadius: 6,
    fontSize: 14,
    controlHeight: 34,
  },
  components: {
    Button: { borderRadius: 6 },
    Modal: { borderRadiusLG: 8 },
    Table: { headerBg: "#f6f8f7", headerColor: "#34413c" },
  },
};

export const proLayoutToken = {
  sider: {
    colorMenuBackground: "#17211d",
    colorTextMenu: "rgba(255,255,255,0.72)",
    colorTextMenuSelected: "#ffffff",
    colorTextMenuActive: "#ffffff",
    colorBgMenuItemSelected: "#285d49",
    colorTextMenuTitle: "#ffffff",
    colorTextMenuItemHover: "#ffffff",
  },
  header: {
    colorBgHeader: "#ffffff",
    colorHeaderTitle: "#18201d",
  },
};
