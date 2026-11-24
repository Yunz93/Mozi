import { useEffect, useState } from 'react';
import {
  getCachedSystemFontFamilies,
  hasCachedSystemFontFamilies,
  listAvailableSystemFontFamilies,
} from '../../services/systemFontService';
import {
  SYSTEM_DEFAULT_FONT_FAMILY,
  buildSystemFontFamily,
} from '../../utils/fontSettings';
import { useI18n } from '../../hooks/useI18n';

export interface FontOption {
  label: string;
  value: string;
}

export function useFontOptions(isOpen: boolean) {
  const { t } = useI18n();
  const [availableSystemFonts, setAvailableSystemFonts] = useState<string[]>(
    () => getCachedSystemFontFamilies() ?? []
  );
  const [isLoadingSystemFonts, setIsLoadingSystemFonts] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const cachedFonts = getCachedSystemFontFamilies();
    if (cachedFonts) {
      setAvailableSystemFonts(cachedFonts);
    }

    if (hasCachedSystemFontFamilies()) {
      setIsLoadingSystemFonts(false);
      return;
    }

    let cancelled = false;
    setIsLoadingSystemFonts(true);

    void listAvailableSystemFontFamilies()
      .then((fontFamilies) => {
        if (cancelled) return;
        setAvailableSystemFonts(fontFamilies);
      })
      .catch((error) => {
        console.error('Failed to load available system fonts:', error);
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingSystemFonts(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const systemFontOptions = availableSystemFonts.map((fontFamily) => ({
    label: fontFamily,
    value: buildSystemFontFamily(fontFamily),
  }));

  const defaultFontOption = {
    label: t('settings_systemDefaultFontOption'),
    value: SYSTEM_DEFAULT_FONT_FAMILY,
  };

  const buildFontOptions = (currentValue: string): FontOption[] => {
    const options = [defaultFontOption, ...systemFontOptions];

    if (!options.some((option) => option.value === currentValue)) {
      options.unshift({
        label: t('settings_uiFontCurrentOption'),
        value: currentValue,
      });
    }

    return options;
  };

  return { buildFontOptions, isLoadingSystemFonts };
}
