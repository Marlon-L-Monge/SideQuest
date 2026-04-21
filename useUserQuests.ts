"use client";
import { useCallback, useMemo } from "react";
import { useLocalStorage } from "./useLocalStorage";
import type { Quest, UserQuestDraft, Category, Tag, Mood } from "@/types";

function generateId(): string {
  return `uq_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function inferMoods(category: Category, tags: Tag[]): Mood[] {
  const moods: Set<Mood> = new Set();
  const catMap: Partial<Record<Category, Mood[]>> = {
    "Cafe":       ["Chill", "Productive"],
    "Food":       ["Social", "Chill"],
    "Nature":     ["Adventurous", "Chill", "Get me out of my room"],
    "Nightlife":  ["Social", "Adventurous"],
    "Date Spot":  ["Romantic", "Chill"],
    "Study Spot": ["Productive"],
    "Hidden Gem": ["Adventurous", "Get me out of my room"],
    "Dessert":    ["Chill", "Social", "Romantic"],
    "Scenic":     ["Chill", "Adventurous", "Romantic"],
    "Activity":   ["Adventurous", "Social", "Get me out of my room"],
  };
  catMap[category]?.forEach((m) => moods.add(m));
  if (tags.includes("Solo Friendly")) moods.add("Productive");
  if (tags.includes("Group Friendly")) moods.add("Social");
  if (tags.includes("Late Night")) moods.add("Get me out of my room");
  return Array.from(moods).slice(0, 3);
}

export function isValidImageUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const ext = parsed.pathname.split(".").pop()?.toLowerCase() ?? "";
    const validExts = ["jpg", "jpeg", "png", "webp", "gif", "avif"];
    const validHosts = ["unsplash.com", "images.unsplash.com", "imgur.com", "i.imgur.com"];
    return validExts.includes(ext) || validHosts.some((h) => parsed.hostname.includes(h));
  } catch {
    return false;
  }
}

const CATEGORY_PLACEHOLDERS: Record<Category, string> = {
  "Cafe":       "https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=800&q=80",
  "Food":       "https://images.unsplash.com/photo-1555126634-323283e090fa?w=800&q=80",
  "Nature":     "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=800&q=80",
  "Nightlife":  "https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=800&q=80",
  "Date Spot":  "https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=800&q=80",
  "Study Spot": "https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=800&q=80",
  "Hidden Gem": "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=800&q=80",
  "Dessert":    "https://images.unsplash.com/photo-1488900128323-21503983a07e?w=800&q=80",
  "Scenic":     "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80",
  "Activity":   "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800&q=80",
  "Skill": "⚡",
  "Challenge": "🎯",
  "Adventure": "🗺",
};

export interface SubmitResult {
  success: boolean;
  error?: string;
  quest?: Quest;
}

export function useUserQuests() {
  const [userQuests, setUserQuests, hydrated] = useLocalStorage<Quest[]>(
    "sidequest:userQuests",
    []
  );

  const submitQuest = useCallback(
    (draft: UserQuestDraft): SubmitResult => {
      const title = draft.title.trim();
      const description = draft.description.trim();
      const neighborhood = draft.neighborhood.trim();
      const address = draft.address.trim();

      if (!title) return { success: false, error: "Name is required." };
      if (title.length < 3) return { success: false, error: "Name is too short — be specific." };
      if (!description) return { success: false, error: "Description is required." };
      if (description.length < 20) return { success: false, error: "Add more detail (at least 20 characters)." };
      if (!neighborhood) return { success: false, error: "Neighborhood is required." };
      if (!address) return { success: false, error: "Address is required." };

      const image = isValidImageUrl(draft.image)
        ? draft.image
        : CATEGORY_PLACEHOLDERS[draft.category];

      const quest: Quest = {
        id: generateId(),
        title,
        description,
        category: draft.category,
        tags: draft.tags,
        moods: draft.moods.length > 0 ? draft.moods : inferMoods(draft.category, draft.tags),
        cost: draft.cost,
        effortLabel: draft.effortLabel,
        energy: draft.energy,
        bestTime: draft.bestTime,
        vibeScore: 7,
        timeEstimate: draft.timeEstimate || "30–60 min",
        rating: 4.0,
        address,
        neighborhood,
        lat: 37.3382,
        lng: -121.8863,
        image,
        isHiddenGem: draft.isHiddenGem,
        openLate: draft.openLate,
        hours: draft.hours.trim() || undefined,
        source: "community",
        submittedBy: draft.submittedBy.trim() || "Anonymous",
        submittedAt: new Date().toISOString(),
      };

      setUserQuests((prev) => [quest, ...prev]);
      return { success: true, quest };
    },
    [setUserQuests]
  );

  const deleteQuest = useCallback(
    (questId: string) => setUserQuests((prev) => prev.filter((q) => q.id !== questId)),
    [setUserQuests]
  );

  const sortedUserQuests = useMemo(
    () =>
      [...userQuests].sort((a, b) => {
        const ta = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
        const tb = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
        return tb - ta;
      }),
    [userQuests]
  );

  return {
    userQuests: sortedUserQuests,
    recentSubmissions: sortedUserQuests.slice(0, 5),
    submitQuest,
    deleteQuest,
    hydrated,
    count: userQuests.length,
  };
}
