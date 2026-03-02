import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export const gitConfig = {
  user: "fcannizzaro",
  repo: "native-window",
  branch: "main",
};

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: "native-window",
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
