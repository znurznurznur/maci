import { BookOpen, FileText, Video, FileCode } from "lucide-react";
import type { TierDraft } from "@/src/services/checkpointStore";

// Default membership tier set (userJourneys.md Section 1) — the starting point a community
// admin customizes from; also used as the fixed default for the "register existing community"
// manual path, which doesn't build its own tier editor.
export const DEFAULT_MEMBERSHIP_TIERS: TierDraft[] = [
  {
    label: "Guest",
    canCreateProposals: false,
    canVote: false,
    canManageMembership: false,
    canCreateEvents: false,
    requiresCredential: null,
  },
  {
    label: "Visitor",
    canCreateProposals: false,
    canVote: false,
    canManageMembership: false,
    canCreateEvents: false,
    requiresCredential: null,
  },
  {
    label: "Regular",
    canCreateProposals: false,
    canVote: true,
    canManageMembership: false,
    canCreateEvents: true,
    requiresCredential: null,
  },
  {
    label: "OG",
    canCreateProposals: true,
    canVote: true,
    canManageMembership: false,
    canCreateEvents: true,
    requiresCredential: null,
  },
  {
    label: "Manager",
    canCreateProposals: true,
    canVote: true,
    canManageMembership: true,
    canCreateEvents: true,
    requiresCredential: null,
  },
  {
    label: "Admin",
    canCreateProposals: true,
    canVote: true,
    canManageMembership: true,
    canCreateEvents: true,
    requiresCredential: null,
  },
];

// Maps to EPolicy enum in @maci-protocol/core
export const ALLOWED_POLICIES = [
  { id: "1", name: "Free For All" },
  { id: "4", name: "Ethereum Attestation Service (EAS)" },
  { id: "5", name: "Gitcoin Passport" },
  { id: "6", name: "Zupass" },
  { id: "7", name: "Semaphore" },
  { id: "8", name: "Anon Aadhaar" },
  { id: "0", name: "ERC20 Token" },
  { id: "3", name: "ERC20 Votes Token" },
  { id: "9", name: "Token (NFT)" },
  { id: "2", name: "Merkle Proof" },
  { id: "10", name: "Hats Protocol" },
];

// Maps to EMode enum in @maci-protocol/core
export const VOTING_MODES = [
  { id: "0", name: "Quadratic Voting (QV)" },
  { id: "1", name: "Non-Quadratic Voting (NON_QV)" },
  { id: "2", name: "Full Voice Credits (FULL)" },
  { id: "3", name: "Ranked Choice (RANKED)" },
];

export const DOCUMENTS = [
  {
    id: "1",
    title: "Getting Started with ZuGov",
    category: "Guide",
    icon: BookOpen,
    description: "Learn the basics of using ZuGov for community governance",
    lastUpdated: "2026-04-15",
  },
  {
    id: "2",
    title: "Understanding Voting Mechanisms",
    category: "Documentation",
    icon: FileText,
    description: "Deep dive into simple majority, quadratic, and ranked choice voting",
    lastUpdated: "2026-04-20",
  },
  {
    id: "3",
    title: "Setting Up Identity Verification",
    category: "Tutorial",
    icon: Video,
    description: "Step-by-step guide to configure identity providers for your community",
    lastUpdated: "2026-04-25",
  },
  {
    id: "4",
    title: "API Reference",
    category: "Technical",
    icon: FileCode,
    description: "Complete API documentation for integrating with ZuGov",
    lastUpdated: "2026-04-28",
  },
  {
    id: "5",
    title: "Community Best Practices",
    category: "Guide",
    icon: BookOpen,
    description: "Tips and strategies for effective community governance",
    lastUpdated: "2026-04-10",
  },
  {
    id: "6",
    title: "Privacy & Security",
    category: "Documentation",
    icon: FileText,
    description: "Understanding how ZuGov protects user privacy and secures votes",
    lastUpdated: "2026-04-18",
  },
];

export const KNOWLEDGE_BASE_CATEGORIES = ["All", "Guide", "Documentation", "Tutorial", "Technical"];
