import java.util.Arrays;
import java.util.List;

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiMusicUtils;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.MusicControl;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Song storage on the watch (service 0x25, commands 04, 05, 08, 09, 0D; docs/watch-music.md): the requests and the watch's answers, built
 * and parsed by the real Java classes the Android app runs (ported from Gadgetbridge's MusicControl / HuaweiMusicUtils). Writes packetsMusic.json
 * for PacketsMusicTests.swift and WatchMusicTest.kt.
 */
public class GoldenMusic {
    static byte[] b(int... v) {
        byte[] out = new byte[v.length];
        for (int i = 0; i < v.length; i++) out[i] = (byte) v[i];
        return out;
    }

    static JSONArray strings(List<String> list) {
        if (list == null) return null;
        JSONArray a = GoldenSupport.arr();
        for (String s : list) a.put(s);
        return a;
    }

    static Object nullable(Object v) {
        return v == null ? JSONObject.NULL : v;
    }

    static JSONObject capabilities(HuaweiMusicUtils.MusicCapabilities c) {
        JSONObject o = GoldenSupport.obj()
            .put("availableSpace", c.availableSpace)
            .put("supportedFormats", nullable(strings(c.supportedFormats)))
            .put("maxMusicCount", c.maxMusicCount)
            .put("maxPlaylistCount", c.maxPlaylistCount)
            .put("currentMusicCount", c.currentMusicCount)
            .put("unknown", c.unknown);
        if (c.formatsRestrictions == null) {
            o.put("formatsRestrictions", JSONObject.NULL);
        } else {
            JSONArray list = GoldenSupport.arr();
            for (HuaweiMusicUtils.FormatRestrictions r : c.formatsRestrictions) {
                list.put(GoldenSupport.obj()
                    .put("formatIdx", (int) r.formatIdx)
                    .put("name", nullable(r.getName()))
                    .put("sampleRates", r.sampleRates == null ? JSONObject.NULL : new JSONArray(Arrays.asList(r.sampleRates)))
                    .put("musicEncode", (int) r.musicEncode)
                    .put("bitrate", (int) r.bitrate)
                    .put("channels", (int) r.channels)
                    .put("unknownBitrate", (int) r.unknownBitrate));
            }
            o.put("formatsRestrictions", list);
        }
        return o;
    }

    static final PacketsGoldenKit.Dumper INFO = (parsed, fields) -> {
        MusicControl.MusicInfoParams.Response r = (MusicControl.MusicInfoParams.Response) parsed;
        fields.put("frameCount", r.frameCount);
        fields.put("params", capabilities(r.params));
        if (r.pageStruct == null) {
            fields.put("pageStruct", JSONObject.NULL);
        } else {
            JSONArray pages = GoldenSupport.arr();
            for (HuaweiMusicUtils.PageStruct p : r.pageStruct) {
                pages.put(GoldenSupport.obj()
                    .put("startFrame", (int) p.startFrame).put("endFrame", (int) p.endFrame).put("count", (int) p.count)
                    .put("hashCode", p.hashCode == null ? JSONObject.NULL : GoldenSupport.hex(p.hashCode)));
            }
            fields.put("pageStruct", pages);
        }
    };

    static final PacketsGoldenKit.Dumper EXTENDED = (parsed, fields) ->
        fields.put("params", capabilities(((MusicControl.ExtendedMusicInfoParams.Response) parsed).params));

    static final PacketsGoldenKit.Dumper LIST = (parsed, fields) -> {
        MusicControl.MusicList.Response r = (MusicControl.MusicList.Response) parsed;
        fields.put("startFrame", (int) r.startFrame);
        fields.put("endIndex", (int) r.endIndex);
        JSONArray songs = GoldenSupport.arr();
        for (MusicControl.MusicList.Song s : r.musicList) {
            songs.put(GoldenSupport.obj().put("id", s.id).put("title", s.title).put("artist", s.artist).put("fileName", s.fileName));
        }
        fields.put("songs", songs);
    };

    static final PacketsGoldenKit.Dumper OPERATION = (parsed, fields) -> {
        MusicControl.MusicOperation.Response r = (MusicControl.MusicOperation.Response) parsed;
        fields.put("resultCode", r.resultCode);
        fields.put("operation", r.operation);
        fields.put("playlistIndex", r.playlistIndex);
        fields.put("playlistName", nullable(r.playlistName));
        fields.put("musicIds", r.musicIds == null ? JSONObject.NULL : new JSONArray(r.musicIds));
    };

    static final PacketsGoldenKit.Dumper UPLOAD_INFO = (parsed, fields) -> {
        MusicControl.UploadMusicFileInfo.UploadMusicFileInfoRequest r = (MusicControl.UploadMusicFileInfo.UploadMusicFileInfoRequest) parsed;
        fields.put("songIndex", (int) r.songIndex);
        fields.put("songFileName", r.songFileName);
    };

    static HuaweiTLV song(int id, String title, String artist, String fileName) {
        HuaweiTLV t = new HuaweiTLV().put(0x04, (short) id);
        if (title != null) t.put(0x05, title);
        if (artist != null) t.put(0x06, artist);
        if (fileName != null) t.put(0x07, fileName);
        return t;
    }

    static HuaweiTLV songPage(int startFrame, int endIndex, HuaweiTLV... songs) {
        HuaweiTLV list = new HuaweiTLV();
        for (HuaweiTLV s : songs) list.put(0x83, s);
        HuaweiTLV t = new HuaweiTLV().put(0x01, (short) startFrame).put(0x04, (short) endIndex);
        if (songs.length > 0) t.put(0x82, list);
        return t;
    }

    public static void main(String[] args) throws Exception {
        JSONObject root = GoldenSupport.obj();

        JSONArray requests = GoldenSupport.arr();
        requests.put(PacketsGoldenKit.request("info params", new MusicControl.MusicInfoParams.Request(PacketsGoldenKit.params())));
        requests.put(PacketsGoldenKit.request("extended info params", new MusicControl.ExtendedMusicInfoParams.Request(PacketsGoldenKit.params())));
        for (int[] page : new int[][] {{0, 65535}, {1, 37}, {249, 1000}}) {
            JSONObject o = PacketsGoldenKit.request("list " + page[0] + " to " + page[1],
                new MusicControl.MusicList.Request(PacketsGoldenKit.params(), (short) page[0], (short) page[1]));
            o.put("startFrame", page[0]).put("endIndex", page[1]);
            requests.put(o);
        }
        for (Integer[] ids : new Integer[][] {{7}, {1, 2, 300}, {65535}}) {
            JSONObject o = PacketsGoldenKit.request("delete " + Arrays.toString(ids),
                new MusicControl.MusicOperation.Request(PacketsGoldenKit.params(), MusicControl.MusicOperation.OPERATION_REMOVE_SONGS,
                    MusicControl.MusicOperation.PLAYLIST_ALL_SONGS, null, Arrays.asList(ids)));
            o.put("ids", new JSONArray(Arrays.asList(ids)));
            requests.put(o);
        }
        String[][] infos = {{"3", "Lari Pagi", "Joyo Band"}, {"0", "Bengawan Solo", "Gesang"}, {"12", "Ünïcødé ♪ 歌", "Ärtist"}, {"5", "", ""}};
        for (String[] info : infos) {
            JSONObject o = PacketsGoldenKit.request("upload info " + info[0] + " " + info[1],
                new MusicControl.UploadMusicFileInfo.UploadMusicFileInfoResponse(PacketsGoldenKit.params(), Short.parseShort(info[0]), info[1], info[2]));
            o.put("songIndex", Integer.parseInt(info[0])).put("title", info[1]).put("artist", info[2]);
            requests.put(o);
        }
        root.put("requests", requests);

        JSONArray responses = GoldenSupport.arr();
        int s = MusicControl.id;
        // 25/04: frame count, free space, format bits (mp3 aac | m4a), max and current songs.
        responses.put(PacketsGoldenKit.response("info full", s, 0x04, new HuaweiTLV()
            .put(0x01, (short) 2).put(0x02, 1500).put(0x03, b(0x85, 0x04)).put(0x04, (short) 500).put(0x05, (short) 12)
            .serialize(), PacketsGoldenKit.params(), INFO));
        responses.put(PacketsGoldenKit.response("info mp3 only, one-byte values", s, 0x04, new HuaweiTLV()
            .put(0x01, (byte) 1).put(0x02, (byte) 200).put(0x03, b(0x01)).put(0x04, (byte) 100).put(0x05, (byte) 0)
            .serialize(), PacketsGoldenKit.params(), INFO));
        responses.put(PacketsGoldenKit.response("info three format bytes", s, 0x04, new HuaweiTLV()
            .put(0x01, (short) 0).put(0x03, b(0xff, 0xff, 0x03, 0x01))
            .serialize(), PacketsGoldenKit.params(), INFO));
        responses.put(PacketsGoldenKit.response("info empty format bits", s, 0x04, new HuaweiTLV()
            .put(0x01, (short) 0).put(0x03, new byte[0])
            .serialize(), PacketsGoldenKit.params(), INFO));
        responses.put(PacketsGoldenKit.response("info with pages", s, 0x04, new HuaweiTLV()
            .put(0x01, (short) 2).put(0x02, 900).put(0x03, b(0x05))
            .put(0x86, new HuaweiTLV()
                .put(0x87, new HuaweiTLV().put(0x08, (short) 0).put(0x09, (short) 19).put(0x0a, (short) 20).put(0x0b, b(1, 2, 3, 4)))
                .put(0x87, new HuaweiTLV().put(0x08, (short) 20).put(0x09, (short) 24).put(0x0a, (short) 5)))
            .serialize(), PacketsGoldenKit.params(), INFO));
        responses.put(PacketsGoldenKit.response("info without frame count", s, 0x04, new HuaweiTLV()
            .put(0x02, 900)
            .serialize(), PacketsGoldenKit.params(), INFO));

        // 25/0D: free space, formats, max songs, max playlists, the unknown byte, per-format limits.
        responses.put(PacketsGoldenKit.response("extended full", s, 0x0d, new HuaweiTLV()
            .put(0x01, 1200).put(0x02, b(0x05)).put(0x03, (short) 500).put(0x04, (byte) 10).put(0x05, (byte) 1)
            .put(0x86, new HuaweiTLV()
                .put(0x87, new HuaweiTLV().put(0x08, (byte) 0).put(0x09, "44100,48000").put(0x0a, (byte) 1).put(0x0b, (short) 320).put(0x0c, (byte) 2))
                .put(0x87, new HuaweiTLV().put(0x08, (byte) 2).put(0x09, "44100").put(0x0b, (short) 256).put(0x0d, (short) 128))
                .put(0x87, new HuaweiTLV().put(0x08, (byte) 40)))
            .serialize(), PacketsGoldenKit.params(), EXTENDED));
        responses.put(PacketsGoldenKit.response("extended free space only", s, 0x0d, new HuaweiTLV()
            .put(0x01, (short) 64)
            .serialize(), PacketsGoldenKit.params(), EXTENDED));

        // 25/05: a page of songs.
        responses.put(PacketsGoldenKit.response("list two songs", s, 0x05, songPage(0, 65535,
            song(1, "Lari Pagi", "Joyo Band", "lari_pagi.mp3"), song(2, "Bengawan Solo", "Gesang", "bengawan.mp3")).serialize(),
            PacketsGoldenKit.params(), LIST));
        responses.put(PacketsGoldenKit.response("list one song, unicode", s, 0x05, songPage(1, 37,
            song(300, "Ünïcødé ♪ 歌", "Ärtist", "ünï.m4a")).serialize(), PacketsGoldenKit.params(), LIST));
        responses.put(PacketsGoldenKit.response("list song without title and artist", s, 0x05, songPage(0, 2,
            song(9, null, null, "nameless.mp3")).serialize(), PacketsGoldenKit.params(), LIST));
        responses.put(PacketsGoldenKit.response("list empty", s, 0x05, songPage(0, 0).serialize(), PacketsGoldenKit.params(), LIST));
        responses.put(PacketsGoldenKit.response("list song without id", s, 0x05, songPage(0, 1,
            new HuaweiTLV().put(0x05, "No id").put(0x06, "x").put(0x07, "x.mp3")).serialize(), PacketsGoldenKit.params(), LIST));

        // 25/08: the answer to a delete.
        responses.put(PacketsGoldenKit.response("operation delete ok", s, 0x08, new HuaweiTLV()
            .put(0x7f, MusicControl.successValue).put(0x01, (byte) 4).put(0x02, (short) 0).put(0x04, b(0x00, 0x07, 0x01, 0x2c))
            .serialize(), PacketsGoldenKit.params(), OPERATION));
        responses.put(PacketsGoldenKit.response("operation error only", s, 0x08, new HuaweiTLV()
            .put(0x7f, 140001)
            .serialize(), PacketsGoldenKit.params(), OPERATION));
        responses.put(PacketsGoldenKit.response("operation odd id bytes", s, 0x08, new HuaweiTLV()
            .put(0x7f, MusicControl.successValue).put(0x01, (byte) 4).put(0x04, b(0x00, 0x07, 0x01))
            .serialize(), PacketsGoldenKit.params(), OPERATION));

        // 25/09: the watch asks for a song's title and artist during the upload.
        responses.put(PacketsGoldenKit.response("upload info request", s, 0x09, new HuaweiTLV()
            .put(0x01, (short) 3).put(0x02, "lari_pagi.mp3")
            .serialize(), PacketsGoldenKit.params(), UPLOAD_INFO));
        responses.put(PacketsGoldenKit.response("upload info request without name", s, 0x09, new HuaweiTLV()
            .put(0x01, (short) 3)
            .serialize(), PacketsGoldenKit.params(), UPLOAD_INFO));
        root.put("responses", responses);

        GoldenSupport.write(args[0], "packetsMusic.json", root);
    }
}
