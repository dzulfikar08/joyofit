/*  Copyright (C) 2024 Damien Gaignon, Martin.JM

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
// Modified for watch-fit (AGPL-3.0-or-later): added length guards against empty TLV byte arrays in Control.Response and safe null defaults.
// Song storage (UploadMusicFileInfo 09, MusicInfoParams 04, MusicList 05, MusicOperation 08, ExtendedMusicInfoParams 0D) ported from
// Gadgetbridge commit c8e59392 (MusicControl.java): a plain Song class instead of GBDeviceMusic, a song without title, artist or file name
// reads as "" instead of failing the page, MusicOperation.Response ignores an odd trailing id byte (GB throws BufferUnderflowException)
// and ExtendedMusicInfoParams reads tag 0x0d (GB reads 0x0b twice) for its second bitrate.
// Playlists (06, 07) are not ported: JoyoFit lists, uploads and deletes songs only.
package nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets;

import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.List;

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiMusicUtils;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV;

public class MusicControl {
    public static final byte id = 0x25;

    public static final int successValue = 0x000186A0;

    public static class MusicStatusRequest extends HuaweiPacket {
        public MusicStatusRequest(ParamsProvider paramsProvider, byte commandId, int returnValue) {
            super(paramsProvider);

            this.serviceId = MusicControl.id;
            this.commandId = commandId;
            this.tlv = new HuaweiTLV()
                    .put(0x7F, returnValue);
            this.isEncrypted = true;
            this.complete = true;
        }
    }

    public static class MusicStatusResponse extends HuaweiPacket {
        public static final byte id = 0x01;

        public int status = -1;

        public MusicStatusResponse(ParamsProvider paramsProvider) {
            super(paramsProvider);

            this.serviceId = MusicControl.id;
            this.commandId = id;
        }

        @Override
        public void parseTlv() throws ParseException {
            if (this.tlv.contains(0x7F) && this.tlv.getBytes(0x7F).length == 4) {
                this.status = this.tlv.getInteger(0x7F);
            }
        }
    }

    public static class MusicInfo {
        public static final byte id = 0x02;

        public static class Request extends HuaweiPacket {
            public Request(
                    ParamsProvider paramsProvider,
                    String artistName,
                    String songName,
                    byte playState,
                    byte maxVolume,
                    byte currentVolume
            ) {
                super(paramsProvider);
                this.serviceId = MusicControl.id;
                this.commandId = id;
                this.tlv = new HuaweiTLV()
                        .put(0x01, artistName != null ? artistName : "")
                        .put(0x02, songName != null ? songName : "")
                        .put(0x03, playState)
                        .put(0x04, maxVolume)
                        .put(0x05, currentVolume);
                this.complete = true;
            }
        }

        public static class Response extends HuaweiPacket {
            public boolean ok = false;
            public String error = "No input has been parsed yet";

            public Response(ParamsProvider paramsProvider) {
                super(paramsProvider);

                this.serviceId = MusicControl.id;
                this.commandId = id;

                this.isEncrypted = true;
            }

            @Override
            public void parseTlv() throws ParseException {
                if (this.tlv.contains(0x7F) && this.tlv.getBytes(0x7F).length == 4) {
                    int code = this.tlv.getInteger(0x7F);
                    if (code == successValue) {
                        this.ok = true;
                        this.error = "";
                    } else {
                        this.ok = false;
                        this.error = "Music information error code: " + Integer.toHexString(code);
                    }
                } else {
                    this.ok = false;
                    this.error = "Music information response no status tag";
                }
            }
        }
    }

    public static class Control {
        public static final byte id = 0x03;

        public static class Response extends HuaweiPacket {
            public enum Button {
                Unknown,
                Play,
                Pause,
                Previous,
                Next,
                Volume_up,
                Volume_down
            }

            public boolean buttonPresent = false;
            public byte rawButton = 0x00;
            public boolean volumePresent = false;
            public byte volume = 0x00;

            public Button button = null;

            public Response(ParamsProvider paramsProvider) {
                super(paramsProvider);

                this.serviceId = MusicControl.id;
                this.commandId = id;

                this.isEncrypted = false;
            }

            @Override
            public void parseTlv() throws ParseException {
                if (this.tlv.contains(0x01)) {
                    byte[] bytes = this.tlv.getBytes(0x01);
                    if (bytes != null && bytes.length > 0) {
                        this.buttonPresent = true;
                        this.rawButton = bytes[bytes.length - 1];
                        switch (this.rawButton) {
                            case 1:
                                this.button = Button.Play;
                                break;
                            case 2:
                                this.button = Button.Pause;
                                break;
                            case 3:
                                this.button = Button.Previous;
                                break;
                            case 4:
                                this.button = Button.Next;
                                break;
                            case 5:
                                this.button = Button.Volume_up;
                                break;
                            case 6:
                                this.button = Button.Volume_down;
                                break;
                            case 64:
                            case 100:
                                // Exit from music control screen on the watch
                                this.buttonPresent = false;
                                this.button = Button.Unknown;
                                break;
                            default:
                                this.button = Button.Unknown;
                                break;
                        }
                    }
                }

                if (this.tlv.contains(0x02)) {
                    byte[] bytes = this.tlv.getBytes(0x02);
                    if (bytes != null && bytes.length > 0) {
                        this.volumePresent = true;
                        this.volume = bytes[bytes.length - 1];
                    }
                }
            }
        }
    }

    /** Watch to phone during a song upload: which song index and file name it needs the title and artist for; the phone answers. */
    public static class UploadMusicFileInfo {
        public static final byte id = 0x09;

        public static class UploadMusicFileInfoRequest extends HuaweiPacket {
            public short songIndex;
            public String songFileName;

            public UploadMusicFileInfoRequest(ParamsProvider paramsProvider) {
                super(paramsProvider);
                this.serviceId = MusicControl.id;
                this.commandId = id;
            }

            @Override
            public void parseTlv() throws ParseException {
                this.songIndex = this.tlv.getShort(0x01);
                this.songFileName = this.tlv.getString(0x02);
            }
        }

        public static class UploadMusicFileInfoResponse extends HuaweiPacket {
            public UploadMusicFileInfoResponse(ParamsProvider paramsProvider, short songIndex, String songName, String songArtist) {
                super(paramsProvider);

                this.serviceId = MusicControl.id;
                this.commandId = id;

                this.tlv = new HuaweiTLV().put(0x01, songIndex).put(0x03, songName).put(0x04, songArtist);

                this.complete = true;
            }
        }
    }

    /** Free space, formats and song counts of the watch's music store, and the list's frame count. */
    public static class MusicInfoParams {
        public static final byte id = 0x04;

        public static class Request extends HuaweiPacket {
            public Request(ParamsProvider paramsProvider) {
                super(paramsProvider);
                this.serviceId = MusicControl.id;
                this.commandId = id;

                this.tlv = new HuaweiTLV()
                        .put(0x01)
                        .put(0x02)
                        .put(0x03);

                this.complete = true;
            }
        }

        public static class Response extends HuaweiPacket {
            public HuaweiMusicUtils.MusicCapabilities params = new HuaweiMusicUtils.MusicCapabilities();

            public int frameCount = 0;
            public List<HuaweiMusicUtils.PageStruct> pageStruct = null;

            public Response(ParamsProvider paramsProvider) {
                super(paramsProvider);
            }

            @Override
            public void parseTlv() throws ParseException {
                this.frameCount = this.tlv.getAsInteger(0x01);

                if (this.tlv.contains(0x02))
                    params.availableSpace = this.tlv.getAsInteger(0x02);
                if (this.tlv.contains(0x03)) {
                    byte[] formatBits = this.tlv.getBytes(0x03);
                    params.supportedFormats = HuaweiMusicUtils.parseFormatBits(formatBits);
                }
                if (this.tlv.contains(0x04))
                    params.maxMusicCount = this.tlv.getAsInteger(0x04);
                if (this.tlv.contains(0x05))
                    params.currentMusicCount = this.tlv.getAsInteger(0x05);

                if (this.tlv.contains(0x86)) {
                    this.pageStruct = new ArrayList<>();
                    List<HuaweiTLV> subTlvs = this.tlv.getObject(0x86).getObjects(0x87);
                    for (HuaweiTLV subTlv : subTlvs) {
                        HuaweiMusicUtils.PageStruct pageStruct = new HuaweiMusicUtils.PageStruct();
                        if (subTlv.contains(0x08))
                            pageStruct.startFrame = subTlv.getShort(0x08);
                        if (subTlv.contains(0x09))
                            pageStruct.endFrame = subTlv.getShort(0x09);
                        if (subTlv.contains(0x0a))
                            pageStruct.count = subTlv.getShort(0x0a);
                        if (subTlv.contains(0x0b))
                            pageStruct.hashCode = subTlv.getBytes(0x0b);
                        this.pageStruct.add(pageStruct);
                    }
                }
            }
        }
    }

    /** One page ("frame") of the songs on the watch. */
    public static class MusicList {
        public static final byte id = 0x05;

        public static class Song {
            public final int id;
            public final String title;
            public final String artist;
            public final String fileName;

            public Song(int id, String title, String artist, String fileName) {
                this.id = id;
                this.title = title;
                this.artist = artist;
                this.fileName = fileName;
            }
        }

        public static class Request extends HuaweiPacket {
            public Request(ParamsProvider paramsProvider, short startFrame, short endIndex) {
                super(paramsProvider);
                this.serviceId = MusicControl.id;
                this.commandId = id;
                this.tlv = new HuaweiTLV()
                        .put(0x01, startFrame)
                        .put(0x04, endIndex);
            }
        }

        public static class Response extends HuaweiPacket {
            public short startFrame = 0;
            public short endIndex = 0;

            public List<Song> musicList;

            public Response(ParamsProvider paramsProvider) {
                super(paramsProvider);
            }

            @Override
            public void parseTlv() throws ParseException {
                if (tlv.contains(0x1))
                    startFrame = tlv.getShort(0x1);
                if (tlv.contains(0x4))
                    endIndex = tlv.getShort(0x4);
                musicList = new ArrayList<>();
                if (this.tlv.contains(0x82)) {
                    for (HuaweiTLV subTlv : this.tlv.getObject(0x82).getObjects(0x83)) {
                        int index = subTlv.getAsInteger(0x4);
                        String title = subTlv.contains(0x5) ? subTlv.getString(0x5) : "";
                        String artist = subTlv.contains(0x6) ? subTlv.getString(0x6) : "";
                        String fileName = subTlv.contains(0x7) ? subTlv.getString(0x7) : "";
                        musicList.add(new Song(index, title, artist, fileName));
                    }
                }
            }
        }
    }

    /**
     * Playlist and song operations, as Gadgetbridge's music manager uses them: 0 new playlist (name), 1 delete playlist, 2 rename playlist,
     * 3 add songs to a playlist, 4 remove songs from a playlist; operation 4 on playlist 0 ("all songs") deletes the songs from the watch.
     */
    public static class MusicOperation {
        public static final byte id = 0x08;

        public static final int OPERATION_REMOVE_SONGS = 4;
        public static final int PLAYLIST_ALL_SONGS = 0;

        public static class Request extends HuaweiPacket {
            public Request(ParamsProvider paramsProvider, int operation, int playlistIndex, String playlistName, List<Integer> musicIds) {
                super(paramsProvider);
                this.serviceId = MusicControl.id;
                this.commandId = id;
                this.tlv = new HuaweiTLV()
                        .put(0x01, (byte) operation);

                if (operation == 1 || operation == 2 || operation == 3 || operation == 4) {
                    this.tlv.put(0x02, (short) playlistIndex);
                }
                if (operation == 0 || operation == 2) {
                    this.tlv.put(0x03, playlistName);
                }

                if (operation == 3 || operation == 4) {
                    ByteBuffer ids = ByteBuffer.allocate(musicIds.size() * 2);
                    for (Integer musicId : musicIds) {
                        ids.putShort(musicId.shortValue());
                    }
                    this.tlv.put(0x04, ids.array());
                }
            }
        }

        public static class Response extends HuaweiPacket {
            public int operation = -1;
            public int playlistIndex = -1;
            public String playlistName;
            public List<Integer> musicIds = null;
            public int resultCode = -1;

            public Response(ParamsProvider paramsProvider) {
                super(paramsProvider);
            }

            @Override
            public void parseTlv() throws ParseException {
                if (this.tlv.contains(0x7f))
                    resultCode = tlv.getInteger(0x7f);
                if (this.tlv.contains(0x1))
                    operation = tlv.getByte(0x1);
                if (this.tlv.contains(0x2))
                    playlistIndex = tlv.getAsInteger(0x2);
                if (this.tlv.contains(0x3))
                    playlistName = tlv.getString(0x3);

                if (this.tlv.contains(0x4)) {
                    musicIds = new ArrayList<>();
                    ByteBuffer dt = ByteBuffer.wrap(this.tlv.getBytes(0x4));
                    while (dt.remaining() >= 2)
                        musicIds.add((int) dt.getShort());
                }
            }
        }
    }

    /** The newer capability read: free space, formats, song and playlist limits, and per-format sample rate, bitrate and channel limits. */
    public static class ExtendedMusicInfoParams {
        public static final byte id = 0x0d;

        public static class Request extends HuaweiPacket {
            public Request(ParamsProvider paramsProvider) {
                super(paramsProvider);
                this.serviceId = MusicControl.id;
                this.commandId = id;

                this.tlv = new HuaweiTLV()
                        .put(0x01)
                        .put(0x02)
                        .put(0x03)
                        .put(0x04)
                        .put(0x05);

                this.complete = true;
            }
        }

        public static class Response extends HuaweiPacket {
            public HuaweiMusicUtils.MusicCapabilities params = new HuaweiMusicUtils.MusicCapabilities();

            public Response(ParamsProvider paramsProvider) {
                super(paramsProvider);
            }

            @Override
            public void parseTlv() throws ParseException {
                if (this.tlv.contains(0x01))
                    params.availableSpace = this.tlv.getAsInteger(0x01);
                if (this.tlv.contains(0x02)) {
                    byte[] formatBits = this.tlv.getBytes(0x02);
                    params.supportedFormats = HuaweiMusicUtils.parseFormatBits(formatBits);
                }
                if (this.tlv.contains(0x03))
                    params.maxMusicCount = this.tlv.getAsInteger(0x03);
                if (this.tlv.contains(0x04))
                    params.maxPlaylistCount = this.tlv.getAsInteger(0x04);
                if (this.tlv.contains(0x05))
                    params.unknown = this.tlv.getByte(0x05);

                if (this.tlv.contains(0x86)) {
                    params.formatsRestrictions = new ArrayList<>();
                    List<HuaweiTLV> subTlvs = this.tlv.getObject(0x86).getObjects(0x87);
                    for (HuaweiTLV subTlv : subTlvs) {
                        HuaweiMusicUtils.FormatRestrictions restriction = new HuaweiMusicUtils.FormatRestrictions();
                        if (subTlv.contains(0x08))
                            restriction.formatIdx = subTlv.getByte(0x08);
                        if (subTlv.contains(0x09)) {
                            String sampleRates = subTlv.getString(0x09);
                            restriction.sampleRates = sampleRates.split(",");
                        }
                        if (subTlv.contains(0x0a))
                            restriction.musicEncode = subTlv.getByte(0x0a);
                        if (subTlv.contains(0x0b))
                            restriction.bitrate = subTlv.getShort(0x0b);
                        if (subTlv.contains(0x0c))
                            restriction.channels = subTlv.getByte(0x0c);
                        if (subTlv.contains(0x0d))
                            restriction.unknownBitrate = subTlv.getShort(0x0d);
                        params.formatsRestrictions.add(restriction);
                    }
                }
            }
        }
    }
}
