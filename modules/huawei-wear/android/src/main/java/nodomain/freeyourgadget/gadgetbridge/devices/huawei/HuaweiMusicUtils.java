/*  Copyright (C) 2024 Me7c7

    This file is part of Gadgetbridge.

    Gadgetbridge is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    Gadgetbridge is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>. */
// Modified for watch-fit (AGPL-3.0-or-later): ported from Gadgetbridge commit c8e59392 (devices/huawei/HuaweiMusicUtils.java) without the
// androidx annotations and toString() helpers; formatName() is public for the format-bit lookup by index.
package nodomain.freeyourgadget.gadgetbridge.devices.huawei;

import java.util.ArrayList;
import java.util.List;

public class HuaweiMusicUtils {

    /** One page ("frame") of the song list as 25/04 describes it; GB logs it and does not use it. */
    public static class PageStruct {
        public short startFrame = 0;
        public short endFrame = 0;
        public short count = 0;
        public byte[] hashCode = null;
    }

    /** Per-format limits from 25/0D. GB marks musicEncode and unknownBitrate "not sure". */
    public static class FormatRestrictions {
        public byte formatIdx = -1;
        public String[] sampleRates = null;
        public byte musicEncode = -1;
        public short bitrate = -1;
        public byte channels = 2;
        public short unknownBitrate = -1;

        public String getName() {
            return formatName(formatIdx);
        }
    }

    public static class MusicCapabilities {
        /** GB shows it as "Watch storage: %d MB". */
        public int availableSpace = 0;
        public List<String> supportedFormats = null;
        public int maxMusicCount = 0;
        public int maxPlaylistCount = 0;
        /** GB: "not sure". */
        public int currentMusicCount = 0;
        /** GB: "not sure". */
        public int unknown = 0;
        public List<FormatRestrictions> formatsRestrictions = null;
    }

    // GB: "I am not sure about this. Most of formats unknown for me."
    private static final String[] formats = {"mp3", "wav", "aac", "sbc", "msbc", "hwa", "cvsd", "pcm", "ape", "m4a", "flac", "opus", "ogg", "butt", "amr", "imy"};

    private static final String[] formatsByte0 = {"mp3", "wav", "aac", "sbc", "msbc", "hwa", "cvsd"};
    private static final String[] formatsByte1 = {"pcm", "ape", "m4a", "flac", "opus", "ogg", "butt"};
    private static final String[] formatsByte2 = {"amr", "imy"};

    /** The name of format index [index] of the 25/0D restrictions, or null outside the table. */
    public static String formatName(int index) {
        return (index >= 0 && index < formats.length) ? formats[index] : null;
    }

    public static void parseNext(int dt, String[] info, List<String> res) {
        for (byte k = 0; k < info.length; k++) {
            if ((dt & (1 << k)) != 0) {
                res.add(info[k]);
            }
        }
    }

    public static List<String> parseFormats(List<Integer> data) {
        List<String> res = new ArrayList<>();

        if (data.size() >= 1) {
            parseNext(data.get(0), formatsByte0, res);
        }

        if (data.size() >= 2) {
            parseNext(data.get(1), formatsByte1, res);
        }

        if (data.size() >= 3) {
            parseNext(data.get(2), formatsByte2, res);
        }

        return res;
    }

    /** Seven format bits per byte; bit 7 set means another byte follows. */
    public static List<String> parseFormatBits(byte[] formatBits) {
        if (formatBits.length == 0)
            return null;
        List<Integer> toDecode = new ArrayList<>();
        for (byte formatBit : formatBits) {
            int dt = formatBit & 0xFF;
            toDecode.add(dt);
            if ((dt & 128) == 0) break;
        }
        return parseFormats(toDecode);
    }
}
