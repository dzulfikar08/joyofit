import appEn from "./locales/en/app";
import appId from "./locales/id/app";
import cloudEn from "./locales/en/cloud";
import cloudId from "./locales/id/cloud";
import editorEn from "./locales/en/editor";
import editorId from "./locales/id/editor";
import exportEn from "./locales/en/export";
import exportId from "./locales/id/export";
import fieldsEn from "./locales/en/fields";
import fieldsId from "./locales/id/fields";
import helpEn from "./locales/en/help";
import helpId from "./locales/id/help";
import propsEn from "./locales/en/props";
import propsId from "./locales/id/props";
import screenEn from "./locales/en/screen";
import screenId from "./locales/id/screen";
import templatesEn from "./locales/en/templates";
import templatesId from "./locales/id/templates";

/** One namespace per area of the app (each is a file under `locales/<code>/`). `id` is the source language and fixes the key types. */
export const resources = {
  id: { app: appId, cloud: cloudId, editor: editorId, export: exportId, fields: fieldsId, help: helpId, props: propsId, screen: screenId, templates: templatesId },
  en: { app: appEn, cloud: cloudEn, editor: editorEn, export: exportEn, fields: fieldsEn, help: helpEn, props: propsEn, screen: screenEn, templates: templatesEn },
} as const;

export const NAMESPACES = ["app", "cloud", "editor", "export", "fields", "help", "props", "screen", "templates"] as const;
