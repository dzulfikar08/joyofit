import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Platform, RefreshControl, ScrollView, StyleSheet, TextInput, View, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { IconChip, type IconName } from '@/components/IconChip';
import { PressableScale } from '@/components/PressableScale';
import { KeyboardRevealContext, revealDelta } from '@/components/keyboardReveal';
import { refreshSpinnerOffset } from '@/components/refreshSpinner';
import { ThemeDecoration } from '@/components/ThemeDecoration';
import { useTabBarInset } from '@/components/tabBarInset';
import { useKeyboardOverlap } from '@/components/useKeyboardOverlap';
import { spacing, useColors, useTheme, type Tint } from '@/theme';

export interface RefreshProps {
  refreshing: boolean;
  onRefresh: () => void;
  /** False greys the gesture out, e.g. while there is no watch to read from. */
  enabled?: boolean;
}

/**
 * Padding for a screen's scrolling content. Tab-root screens draw their own title and sit under the
 * status bar (`withTitle`); stack screens have a native header that already clears it.
 */
export function useContentPadding(withTitle: boolean, clearTabBar = true): ViewStyle {
  const insets = useSafeAreaInsets();
  // The tab bar floats over the scene: the end of the content clears it so the last item scrolls fully above it.
  const tabBar = useTabBarInset();
  return {
    paddingTop: (withTitle ? insets.top : 0) + spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl + (clearTabBar ? tabBar : 0),
  };
}

/** Pull-to-refresh control in the app colors. `progressViewOffset` moves the spinner down (see `refreshSpinnerOffset`). */
export function useRefreshControl(refresh: RefreshProps | undefined, progressViewOffset = 0) {
  const colors = useColors();
  if (!refresh) return undefined;
  return (
    <RefreshControl
      refreshing={refresh.refreshing}
      onRefresh={refresh.onRefresh}
      enabled={refresh.enabled ?? true}
      progressViewOffset={progressViewOffset}
      colors={[colors.primary]}
      tintColor={colors.primary}
      progressBackgroundColor={colors.card}
    />
  );
}

interface PageHeaderProps {
  title: string;
  caption?: string;
  right?: ReactNode;
}

/** 28 px page title for tab-root screens, with an optional caption and one right-hand action. */
export function PageHeader({ title, caption, right }: PageHeaderProps) {
  return (
    <View style={styles.pageHeader}>
      <View style={styles.pageHeaderText}>
        <AppText variant="title" accessibilityRole="header">
          {title}
        </AppText>
        {caption ? (
          <AppText variant="caption" muted>
            {caption}
          </AppText>
        ) : null}
      </View>
      {right}
    </View>
  );
}

interface ScreenProps {
  /** Draws the big page title; leave out on stack screens that have a native header. */
  title?: string;
  caption?: string;
  right?: ReactNode;
  refresh?: RefreshProps;
  /** False freezes the scroll, e.g. while a chart is being scrubbed. */
  scrollEnabled?: boolean;
  /** The scroll view, for `scrollTo`. */
  scrollRef?: RefObject<ScrollView | null>;
  /** A bar pinned under the scrolling content, lifted above the keyboard (a comment composer). */
  footer?: ReactNode;
  /** Scroll reports for a screen that follows its content (a chat): position, size and layout of the scroll view. */
  scrollProps?: Pick<ScrollViewProps, 'onScroll' | 'onContentSizeChange' | 'onLayout' | 'scrollEventThrottle'>;
  /** Drawn over the bottom of the scrolling area, above the footer (a "jump to latest" button). Only with a `footer`. */
  overlay?: ReactNode;
  /**
   * Replaces the scroll view with the screen's own list (a chat's inverted `FlatList`): called with the padding the content needs
   * (horizontal, and the top and bottom a scroll view would get), which the list puts in its `contentContainerStyle`. `children`
   * are then not drawn. Only with a `footer`.
   */
  list?: (padding: { paddingHorizontal: number; paddingTop: number; paddingBottom: number }) => ReactNode;
  /** Draws the theme's header decoration behind the title (Today). Only meaningful with a `title`. */
  decorated?: boolean;
  children: ReactNode;
}

export function Screen({ title, caption, right, refresh, scrollEnabled = true, scrollRef, scrollProps, footer, overlay, list, decorated = false, children }: ScreenProps) {
  const colors = useColors();
  // With a footer the footer sits above the bar, so the content above it does not clear the bar again.
  const padding = useContentPadding(title !== undefined, footer === undefined);
  const insets = useSafeAreaInsets();
  const refreshControl = useRefreshControl(refresh, refreshSpinnerOffset(title !== undefined, insets.top));
  const { ref: keyboardRef, lift: keyboardLift } = useKeyboardOverlap();
  const tabBar = useTabBarInset();
  // Without a footer nothing lifts above the keyboard, and edge-to-edge Android does not resize the window: pad the content by
  // the overlap so the last field can scroll clear, and scroll the focused input into view. iOS does both natively.
  const ownScrollRef = useRef<ScrollView>(null);
  const scroller = scrollRef ?? ownScrollRef;
  const offsetRef = useRef(0);
  const liftRef = useRef(0);
  const padKeyboard = Platform.OS === 'android' && !footer && !list;
  useLayoutEffect(() => {
    liftRef.current = keyboardLift;
  }, [keyboardLift]);
  const revealFocused = useCallback(() => {
    const input = TextInput.State.currentlyFocusedInput?.();
    if (!input || liftRef.current <= 0) return;
    keyboardRef.current?.measureInWindow((_x, y, _w, h) => {
      const keyboardTop = y + h - liftRef.current;
      input.measureInWindow((_ix, iy, _iw, ih) => {
        const delta = revealDelta(iy + ih, keyboardTop);
        if (delta > 0) scroller.current?.scrollTo({ y: offsetRef.current + delta, animated: true });
      });
    });
  }, [keyboardRef, scroller]);
  // Wait a beat so the padded content has laid out and the scroll range includes it.
  const revealSoon = useCallback(() => {
    setTimeout(revealFocused, 60);
  }, [revealFocused]);
  useEffect(() => {
    if (padKeyboard && keyboardLift > 0) revealSoon();
  }, [padKeyboard, keyboardLift, revealSoon]);
  const scroll = list ? (
    list({ paddingHorizontal: spacing.lg, paddingTop: Number(padding.paddingTop ?? 0), paddingBottom: Number(padding.paddingBottom ?? 0) })
  ) : (
    <ScrollView
      ref={scroller}
      {...scrollProps}
      onScroll={
        padKeyboard
          ? (e) => {
              offsetRef.current = e.nativeEvent.contentOffset.y;
              scrollProps?.onScroll?.(e);
            }
          : scrollProps?.onScroll
      }
      scrollEventThrottle={padKeyboard ? (scrollProps?.scrollEventThrottle ?? 16) : scrollProps?.scrollEventThrottle}
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.content, padding, padKeyboard && keyboardLift > 0 ? { paddingBottom: Number(padding.paddingBottom ?? 0) + keyboardLift } : null]}
      automaticallyAdjustKeyboardInsets={Platform.OS === 'ios' && !footer}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
      scrollEnabled={scrollEnabled}
      showsVerticalScrollIndicator={false}>
      {decorated ? <ThemeDecoration /> : null}
      {title ? <PageHeader title={title} caption={caption} right={right} /> : null}
      {children}
    </ScrollView>
  );
  if (!footer) {
    if (!padKeyboard) return scroll;
    return (
      <KeyboardRevealContext.Provider value={revealSoon}>
        <View ref={keyboardRef} collapsable={false} style={styles.fill}>
          {scroll}
        </View>
      </KeyboardRevealContext.Provider>
    );
  }
  // Under the keyboard the keyboard is the bottom edge; otherwise the footer clears the tab bar or, where there is none, the gesture bar / home indicator.
  const bottom = keyboardLift > 0 ? keyboardLift : Math.max(tabBar, insets.bottom);
  return (
    <View ref={keyboardRef} collapsable={false} style={[styles.fill, { backgroundColor: colors.background, paddingBottom: bottom }]}>
      {/* The same wrapper whether or not there is an overlay: a layer that appears and disappears (a "jump to latest" button) must not
          change the tree above the list, or the list is mounted again and loses its scroll position. */}
      <View style={styles.fill}>
        {scroll}
        {overlay ? (
          <View pointerEvents="box-none" style={styles.overlay}>
            {overlay}
          </View>
        ) : null}
      </View>
      {footer}
    </View>
  );
}

/** Borderless white card, themed radius, padding 16. Sits flat: no border, no shadow (an outlined theme draws a thin hairline border instead). */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { theme, colors, radius } = useTheme();
  const outline = theme.outlined ? { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline } : null;
  return <View style={[styles.card, { backgroundColor: colors.card, borderRadius: radius.card }, outline, style]}>{children}</View>;
}

interface SectionProps {
  title: string;
  icon?: IconName;
  tint?: Tint | 'neutral';
  /** Replaces the icon chip, e.g. a `BrandMark`. */
  leading?: ReactNode;
  /** Right of the title, e.g. a count. */
  trailing?: ReactNode;
  /** Makes the whole card a button that opens more detail; the header gets a chevron. */
  onPress?: () => void;
  children: ReactNode;
}

/** A titled card. The title row carries an icon chip so every section is findable at a glance. */
export function Section({ title, icon, tint = 'neutral', leading, trailing, onPress, children }: SectionProps) {
  const colors = useColors();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader} accessibilityRole="header">
        {leading ?? (icon ? <IconChip icon={icon} tint={tint} size="sm" /> : null)}
        <AppText variant="heading" style={styles.sectionTitle}>
          {title}
        </AppText>
        {trailing}
        {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} /> : null}
      </View>
      {onPress ? (
        <PressableScale accessibilityRole="button" accessibilityLabel={title} onPress={onPress} scaleTo={0.985}>
          <Card>{children}</Card>
        </PressableScale>
      ) : (
        <Card>{children}</Card>
      )}
    </View>
  );
}

export function Divider() {
  const colors = useColors();
  return <View style={[styles.divider, { backgroundColor: colors.hairline }]} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFill, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: spacing.md },
  content: { gap: spacing.lg },
  pageHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 40 },
  pageHeaderText: { flex: 1, gap: 2 },
  section: { gap: spacing.sm },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 28 },
  sectionTitle: { flex: 1 },
  card: { padding: spacing.md + 4, gap: spacing.sm + 2 },
  divider: { height: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
});
