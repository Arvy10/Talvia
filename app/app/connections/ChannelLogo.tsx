import type { IconType } from "react-icons";
import { FaLinkedin } from "react-icons/fa";
import { SiGmail, SiWhatsapp } from "react-icons/si";

import type { ChannelId } from "../state/types";

const logos: Record<ChannelId, { icon: IconType; color: string }> = {
  linkedin: { icon: FaLinkedin, color: "#0A66C2" },
  whatsapp: { icon: SiWhatsapp, color: "#25D366" },
  gmail: { icon: SiGmail, color: "#EA4335" },
};

export function ChannelLogo({ channel }: { channel: ChannelId }) {
  const { icon: Icon, color } = logos[channel];

  return <span aria-hidden="true" className="channel-logo" style={{ color }}><Icon /></span>;
}
