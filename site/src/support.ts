/** Priority support for JoyoRogo Pro: one handle and one promise. Change the account here (and in `src/features/pro/support.ts` of the app). */
export const PRO_SUPPORT = {
  handle: "@dzulfikar.at",
  url: "https://www.threads.com/@dzulfikar.at",
  promise: "dibalas paling lambat 1 hari kerja",
} as const;

export const PRO_SUPPORT_LINE = `Dukungan prioritas: DM Threads ${PRO_SUPPORT.handle}, sebutkan email akun JoyoRogo-mu, ${PRO_SUPPORT.promise}`;
