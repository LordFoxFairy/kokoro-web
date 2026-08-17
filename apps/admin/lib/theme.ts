import { theme, type ThemeConfig } from "antd";

export const ADMIN_LAYOUT = Object.freeze({
  siderWidth: 216,
  headerHeight: 56,
  menuIconSize: 18,
  commandIconSize: 16,
  contentMaxWidth: 1600,
});

export const antdTheme: ThemeConfig = {
  algorithm: [theme.defaultAlgorithm, theme.compactAlgorithm],
  token: {
    colorPrimary: "#1677ff",
    colorInfo: "#1677ff",
    colorSuccess: "#16a34a",
    colorWarning: "#d97706",
    colorError: "#dc2626",
    colorText: "#1f2937",
    colorTextSecondary: "#667085",
    colorBgLayout: "#f5f7fa",
    colorBgContainer: "#ffffff",
    colorBorderSecondary: "#e5e7eb",
    borderRadius: 6,
    fontSize: 14,
    controlHeight: 32,
  },
  components: {
    Button: { borderRadius: 6 },
    Menu: { itemHeight: 36, itemMarginBlock: 2, iconSize: ADMIN_LAYOUT.menuIconSize },
    Modal: { borderRadiusLG: 8 },
    Table: {
      cellPaddingBlockSM: 8,
      cellPaddingInlineSM: 12,
      headerBg: "#fafafa",
      headerColor: "#374151",
    },
  },
};

export const proLayoutToken = {
  sider: {
    colorMenuBackground: "#ffffff",
    colorTextMenu: "#4b5563",
    colorTextMenuSelected: "#1677ff",
    colorTextMenuActive: "#1677ff",
    colorBgMenuItemSelected: "#e6f4ff",
    colorTextMenuTitle: "#1f1f1f",
    colorTextMenuItemHover: "#1677ff",
  },
  header: {
    colorBgHeader: "#ffffff",
    colorHeaderTitle: "#1f1f1f",
    heightLayoutHeader: ADMIN_LAYOUT.headerHeight,
  },
};
