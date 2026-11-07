import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { splitLead } from '@/components/moreTextModel';
import { useColors } from '@/theme';

interface MoreTextProps {
  children: string;
  color?: string;
  muted?: boolean;
  selectable?: boolean;
  style?: React.ComponentProps<typeof AppText>['style'];
}

/**
 * Caption text that shows its first sentence and a "More" link when it runs long, so hints and notices keep a screen
 * scannable (the same idea as `Details`, inline). Short text renders as a plain caption.
 */
export function MoreText({ children, color, muted, selectable, style }: MoreTextProps) {
  const { t } = useTranslation('common');
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const parts = splitLead(children);
  if (parts === null) {
    return (
      <AppText variant="caption" color={color} muted={muted} selectable={selectable} style={style}>
        {children}
      </AppText>
    );
  }
  return (
    <AppText variant="caption" color={color} muted={muted} selectable={selectable} style={style}>
      {open ? children : parts.lead}{' '}
      <AppText
        variant="caption"
        color={color ?? colors.foreground}
        style={{ fontWeight: '700', textDecorationLine: 'underline' }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        suppressHighlighting
        onPress={() => setOpen((v) => !v)}>
        {open ? t('details.less') : t('details.more')}
      </AppText>
    </AppText>
  );
}
