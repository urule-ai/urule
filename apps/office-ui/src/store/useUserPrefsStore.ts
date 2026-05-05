import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * UI density. `comfortable` is the default — extra padding around list
 * rows and form fields. `compact` halves vertical spacing for users who
 * want more on-screen at once.
 */
export type Density = 'comfortable' | 'compact';

/**
 * Default route to land on when navigating to /office. Today the
 * unconditional default is the dashboard; users can pin a different
 * page (e.g. chat-first) here.
 */
export type LandingPage =
  | 'dashboard'
  | 'agents'
  | 'chat'
  | 'approvals'
  | 'projects'
  | 'workspaces';

/**
 * Per-route filter state — keyed by route slug (e.g. `agents`,
 * `approvals`). Values are arbitrary serialisable filter objects;
 * each route component owns the shape.
 */
export type ListFilters = Record<string, Record<string, unknown>>;

/**
 * Favorited entities — arbitrary `(kind, id)` tuples. `kind` is a
 * domain label (`agent`, `package`, `room`) and `id` is the entity id.
 * Stored as an array (not Set) so persist middleware can serialise.
 */
export interface Favorite {
  kind: string;
  id: string;
  label?: string;
}

interface UserPrefsState {
  density: Density;
  landingPage: LandingPage;
  listFilters: ListFilters;
  favorites: Favorite[];
  // Reserved for §6.5 notification-sounds work.
  notificationSoundsEnabled: boolean;

  setDensity: (d: Density) => void;
  setLandingPage: (page: LandingPage) => void;
  setListFilter: (route: string, filter: Record<string, unknown>) => void;
  clearListFilter: (route: string) => void;
  addFavorite: (fav: Favorite) => void;
  removeFavorite: (kind: string, id: string) => void;
  isFavorite: (kind: string, id: string) => boolean;
  setNotificationSoundsEnabled: (enabled: boolean) => void;
  reset: () => void;
}

const DEFAULTS = {
  density: 'comfortable' as Density,
  landingPage: 'dashboard' as LandingPage,
  listFilters: {} as ListFilters,
  favorites: [] as Favorite[],
  notificationSoundsEnabled: false,
};

export const useUserPrefsStore = create<UserPrefsState>()(
  persist(
    (set, get) => ({
      ...DEFAULTS,

      setDensity: (density) => set({ density }),
      setLandingPage: (landingPage) => set({ landingPage }),

      setListFilter: (route, filter) =>
        set((state) => ({ listFilters: { ...state.listFilters, [route]: filter } })),

      clearListFilter: (route) =>
        set((state) => {
          const { [route]: _drop, ...rest } = state.listFilters;
          return { listFilters: rest };
        }),

      addFavorite: (fav) =>
        set((state) => {
          if (state.favorites.some((f) => f.kind === fav.kind && f.id === fav.id)) {
            return state;
          }
          return { favorites: [...state.favorites, fav] };
        }),

      removeFavorite: (kind, id) =>
        set((state) => ({
          favorites: state.favorites.filter((f) => !(f.kind === kind && f.id === id)),
        })),

      isFavorite: (kind, id) =>
        get().favorites.some((f) => f.kind === kind && f.id === id),

      setNotificationSoundsEnabled: (notificationSoundsEnabled) =>
        set({ notificationSoundsEnabled }),

      reset: () => set(DEFAULTS),
    }),
    {
      name: 'urule-user-prefs',
      // Don't persist the action functions — only the state slice.
      partialize: (s) => ({
        density: s.density,
        landingPage: s.landingPage,
        listFilters: s.listFilters,
        favorites: s.favorites,
        notificationSoundsEnabled: s.notificationSoundsEnabled,
      }),
    },
  ),
);
