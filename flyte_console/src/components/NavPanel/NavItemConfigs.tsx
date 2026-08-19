/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { useDomainStore } from "@/lib/DomainStore";
import { formatRecentlyViewedLabel, getUiText } from "@/lib/uiText";
import { FolderIcon } from "@heroicons/react/16/solid";
import {
  AcademicCapIcon,
  CodeBracketIcon,
  CircleStackIcon,
  ComputerDesktopIcon,
  FolderOpenIcon,
  ShareIcon,
} from "@heroicons/react/24/outline";
import { AppsIcon } from "../icons/AppsIcon";
import { RunsIcon } from "../icons/RunsIcon";
import { TriggersIcon } from "../icons/TriggersIcon";
import { DocumentationCard } from "./DocumentationCard";
import { NavPanelWidth, NavWidget, type NavLink as NavLinkType } from "./types";

export const ProjectsLink: NavLinkType = {
  className: "semibold text-white",
  displayText: getUiText("projects"),
  makeHref: () => `/projects`,
  icon: <FolderIcon />,
  type: "link",
  shouldHideIconOnCollapse: true,
};

const ProjectsHeaderWidget = ({ size }: { size: NavPanelWidth }) => {
  const { selectedDomain } = useDomainStore();
  if (!selectedDomain || size === "thin") {
    return null;
  }
  return (
    <span className="pl-2 text-2xs font-semibold dark:text-(--system-gray-5)">
      {formatRecentlyViewedLabel(selectedDomain.name)}
    </span>
  );
};

export const ProjectsHeader: NavWidget = {
  displayText: "projectsHeader",
  type: "widget",
  widget: (size) => <ProjectsHeaderWidget size={size} />,
};

export const RunsLink: NavLinkType = {
  displayText: getUiText("runs"),
  makeHref: ({ project, domain }) =>
    `/domain/${domain}/project/${project}/runs`,
  icon: <RunsIcon className="size-4" />,
  type: "link",
};

export const DevelopmentInstancesLink: NavLinkType = {
  displayText: getUiText("developmentInstances"),
  makeHref: ({ project, domain }) =>
    `/domain/${domain}/project/${project}/development-instances`,
  icon: <ComputerDesktopIcon className="size-4 min-w-4" />,
  type: "link",
};

export const TrainingTasksLink: NavLinkType = {
  displayText: getUiText("trainingTasks"),
  makeHref: ({ project, domain }) =>
    `/domain/${domain}/project/${project}/training-tasks`,
  icon: <AcademicCapIcon className="size-4 min-w-4" />,
  type: "link",
};

export const DatasetsLink: NavLinkType = {
  displayText: getUiText("datasets"),
  makeHref: ({ project, domain }) =>
    `/domain/${domain}/project/${project}/datasets`,
  icon: <FolderOpenIcon className="size-4 min-w-4" />,
  type: "link",
};

export const CloudStorageLink: NavLinkType = {
  displayText: getUiText("cloudStorage"),
  makeHref: ({ project, domain }) =>
    `/domain/${domain}/project/${project}/cloud-storages`,
  icon: <CircleStackIcon className="size-4 min-w-4" />,
  type: "link",
};

export const CodeRepositoriesLink: NavLinkType = {
  displayText: getUiText("codeRepositories"),
  makeHref: ({ project, domain }) =>
    `/domain/${domain}/project/${project}/code-repositories`,
  icon: <CodeBracketIcon className="size-4 min-w-4" />,
  type: "link",
};

export const TasksLink: NavLinkType = {
  displayText: getUiText("tasks"),
  makeHref: ({ project, domain }) =>
    `/domain/${domain}/project/${project}/tasks`,
  icon: <ShareIcon className="size-4 min-w-4" />,
  type: "link",
};

export const TriggersLink: NavLinkType = {
  displayText: getUiText("triggers"),
  makeHref: ({ project, domain }) =>
    `/domain/${domain}/project/${project}/triggers`,
  icon: <TriggersIcon />,
  type: "link",
};

export const AppsLink: NavLinkType = {
  displayText: getUiText("apps"),
  makeHref: ({ project, domain }) =>
    `/domain/${domain}/project/${project}/apps`,
  icon: <AppsIcon />,
  type: "link",
};

export const useDefaultItems = () => {
  return [
    RunsLink,
    DevelopmentInstancesLink,
    TrainingTasksLink,
    DatasetsLink,
    CodeRepositoriesLink,
    CloudStorageLink,
    TriggersLink,
    TasksLink,
    AppsLink,
  ].filter(Boolean) as NavLinkType[];
};

export const DocumentationCardWidget: NavWidget = {
  displayText: getUiText("documentation"),
  type: "widget",
  widget: (size) => <DocumentationCard size={size} />,
};

export const useDefaultOrgItems = () => [DocumentationCardWidget];
