import { Screen } from '@/components/Screen';
import { HuaweiHealthSection } from '@/features/huaweihealth/HuaweiHealthSection';

/** The Health Kit sync (lab); also where `joyofit://settings/huawei-health` lands after the HUAWEI ID page. */
export default function HuaweiHealthScreen() {
  return (
    <Screen>
      <HuaweiHealthSection />
    </Screen>
  );
}
