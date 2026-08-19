/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { AIONE_API_DOCS_URL, FLYTE_DOCS_FLYTE2_URL } from "@/lib/constants";
import { getUiText } from "@/lib/uiText";
import { ArrowUpRightIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { Tooltip } from "../Tooltip";
import { NavPanelWidth } from "./types";

type DocumentationCardProps = {
  size: NavPanelWidth;
};

const documentationLinks = [
  {
    href: FLYTE_DOCS_FLYTE2_URL,
    label: getUiText("userDocs"),
  },
  {
    href: AIONE_API_DOCS_URL,
    label: getUiText("apiDocs"),
  },
] as const;

type DocumentationLinkProps = (typeof documentationLinks)[number] & {
  isThin: boolean;
};

const DocumentationLink = ({ href, isThin, label }: DocumentationLinkProps) => {
  const link = (
    <Link
      aria-label={label}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={clsx(
        "group flex items-center text-(--system-gray-5) transition-colors duration-200",
        "hover:bg-(--union)/10 hover:text-(--union)",
        "focus-visible:bg-(--union)/10 focus-visible:text-(--union) focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-(--union)",
        isThin
          ? "size-8 justify-center"
          : "min-h-11 w-full gap-2.5 px-2.5 py-2",
      )}
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-(--union) text-white transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5">
        <ArrowUpRightIcon className="size-3.5" aria-hidden="true" />
      </span>

      {!isThin && (
        <span className="flex-1 text-sm font-medium whitespace-nowrap">
          {label}
        </span>
      )}
    </Link>
  );

  return isThin ? (
    <Tooltip content={label} placement="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
};

export const DocumentationCard = ({ size }: DocumentationCardProps) => {
  const isThin = size === "thin";

  return (
    <AnimatePresence initial={false}>
      <motion.div
        key="documentation-card"
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
        className={isThin ? "mt-1 mb-2" : "mt-1 mb-2 px-0.5"}
      >
        <div
          aria-label={getUiText("documentation")}
          role="group"
          className={clsx(
            "overflow-hidden rounded-lg border border-(--union)",
            isThin ? "w-8" : "w-[220px]",
          )}
        >
          {documentationLinks.map((item) => (
            <DocumentationLink {...item} isThin={isThin} key={item.label} />
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
