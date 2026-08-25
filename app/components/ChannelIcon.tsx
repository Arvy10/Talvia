import { FaLinkedin } from 'react-icons/fa';
import { SiGmail, SiWhatsapp } from 'react-icons/si';

const CHANNEL_ICONS = {
  linkedin: { Icon: FaLinkedin, bg: '#0A66C2' },
  whatsapp: { Icon: SiWhatsapp, bg: '#25D366' },
  gmail: { Icon: SiGmail, bg: '#EA4335' },
} as const;

export type ChannelKey = keyof typeof CHANNEL_ICONS;

export function ChannelIcon({ channel, size = 18 }: { channel: ChannelKey; size?: number }) {
  const { Icon, bg } = CHANNEL_ICONS[channel];
  return (
    <span className="channel-icon" style={{ background: bg }} aria-hidden="true">
      <Icon size={size} color="#fff" />
    </span>
  );
}
