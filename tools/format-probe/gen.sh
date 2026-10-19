set -u
F="ffmpeg -hide_banner -loglevel error -y"
V="-f lavfi -i testsrc2=size=640x360:rate=30:duration=2"
A="-f lavfi -i sine=frequency=440:duration=2:sample_rate=48000"
mk(){ out=$1; shift; $F "$@" "$out" 2>/dev/null || echo "GENFAIL $out"; }
# video
mk v_h264_aac.mp4 $V $A -c:v libx264 -pix_fmt yuv420p -c:a aac
mk v_h264_aac.mov $V $A -c:v libx264 -pix_fmt yuv420p -c:a aac
mk v_h264_aac.m4v $V $A -c:v libx264 -pix_fmt yuv420p -c:a aac -f mp4
mk v_h264_10bit.mp4 $V -c:v libx264 -pix_fmt yuv420p10le -profile:v high10
mk v_hevc_hvc1.mp4 $V $A -c:v libx265 -tag:v hvc1 -pix_fmt yuv420p -c:a aac
mk v_hevc_hev1.mp4 $V $A -c:v libx265 -pix_fmt yuv420p -c:a aac
mk v_hevc_10bit.mov $V -c:v libx265 -tag:v hvc1 -pix_fmt yuv420p10le
mk v_prores422.mov $V $A -c:v prores_ks -profile:v 2 -c:a pcm_s16le
mk v_prores4444.mov $V -c:v prores_ks -profile:v 4 -pix_fmt yuva444p10le
mk v_dnxhd.mov -f lavfi -i testsrc2=size=1920x1080:rate=30000/1001:duration=1 -c:v dnxhd -b:v 145M -pix_fmt yuv422p
mk v_av1_opus.mp4 $V $A -c:v libsvtav1 -c:a libopus
mk v_av1_opus.webm $V $A -c:v libsvtav1 -c:a libopus
mk v_vp9_opus.webm $V $A -c:v libvpx-vp9 -c:a libopus
mk v_vp8_vorbis.webm $V $A -c:v libvpx -c:a vorbis -strict -2 -ac 2
mk v_h264_aac.mkv $V $A -c:v libx264 -pix_fmt yuv420p -c:a aac
mk v_hevc_aac.mkv $V $A -c:v libx265 -pix_fmt yuv420p -c:a aac
mk v_vp9_opus.mkv $V $A -c:v libvpx-vp9 -c:a libopus
mk v_mpeg4_mp3.avi $V $A -c:v mpeg4 -c:a libmp3lame
mk v_h264_mp3.avi $V $A -c:v libx264 -pix_fmt yuv420p -c:a libmp3lame
mk v_wmv2_wma.wmv $V $A -c:v wmv2 -c:a wmav2
mk v_mpeg2.mpg $V $A -c:v mpeg2video -c:a mp2
mk v_h264_aac.ts $V $A -c:v libx264 -pix_fmt yuv420p -c:a aac
mk v_h264_aac.m2ts $V $A -c:v libx264 -pix_fmt yuv420p -c:a aac -f mpegts
mk v_h264_aac.3gp $V $A -c:v libx264 -pix_fmt yuv420p -c:a aac
mk v_h264_ac3.mp4 $V $A -c:v libx264 -pix_fmt yuv420p -c:a ac3
mk v_h264_eac3.mp4 $V $A -c:v libx264 -pix_fmt yuv420p -c:a eac3
mk v_h264_alac.mov $V $A -c:v libx264 -pix_fmt yuv420p -c:a alac
mk v_h264_pcm.mov $V $A -c:v libx264 -pix_fmt yuv420p -c:a pcm_s16le
mk v_mjpeg.avi $V -c:v mjpeg
mk v_h264_aac.flv $V $A -c:v libx264 -pix_fmt yuv420p -c:a aac
mk v_dv.dv -f lavfi -i testsrc2=size=720x480:rate=30000/1001:duration=1 -f lavfi -i sine=duration=1:sample_rate=48000 -c:v dvvideo -pix_fmt yuv411p -c:a pcm_s16le -ac 2
# audio
mk a_mp3.mp3 $A -c:a libmp3lame
mk a_aac.m4a $A -c:a aac
mk a_aac.aac $A -c:a aac -f adts
mk a_alac.m4a $A -c:a alac
mk a_pcm16.wav $A -c:a pcm_s16le
mk a_pcm24.wav $A -c:a pcm_s24le
mk a_float32.wav $A -c:a pcm_f32le
mk a_pcm16.aiff $A -c:a pcm_s16be
mk a_pcm24.aiff $A -c:a pcm_s24be
mk a_flac.flac $A -c:a flac
mk a_opus.ogg $A -c:a libopus
mk a_opus.opus $A -c:a libopus
mk a_vorbis.ogg $A -c:a vorbis -strict -2 -ac 2
mk a_wma.wma $A -c:a wmav2
mk a_ac3.ac3 $A -c:a ac3
mk a_eac3.eac3 $A -c:a eac3
mk a_flac.mka $A -c:a flac
mk a_opus.webm $A -c:a libopus -vn
mk a_mp2.mp2 $A -c:a mp2
afconvert -f caff -d LEI16 a_pcm16.wav a_pcm16.caf || echo GENFAIL caf
afconvert -f AIFC -d ulaw a_pcm16.wav a_ulaw.aifc || echo GENFAIL aifc
# images
mk i_src.png -f lavfi -i testsrc2=size=640x360 -frames:v 1
cp i_src.png i_png.png
mk i_apng.apng -f lavfi -i testsrc2=size=160x90:rate=5:duration=1 -plays 0 -f apng
mk i_gif.gif -f lavfi -i testsrc2=size=160x90:rate=5:duration=1
mk i_bmp.bmp -i i_src.png
mk i_tiff_ff.tiff -i i_src.png
for f in jpeg:i_jpeg.jpg heic:i_heic.heic avif:i_avif.avif tiff:i_tiff_lzw.tif jp2:i_jp2.jp2 psd:i_psd.psd openexr:i_exr.exr tga:i_tga.tga ico:i_ico.ico icns:i_icns.icns pdf:i_pdf.pdf dds:i_dds.dds; do
  fmt=${f%%:*}; out=${f#*:}
  src=i_src.png; [ "$fmt" = ico ] || [ "$fmt" = icns ] && { sips -z 256 256 i_src.png --out sq.png >/dev/null; src=sq.png; }
  sips -s format $fmt $src --out $out >/dev/null 2>&1 || echo GENFAIL $out
done
cat > t_svg.svg <<'S'
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="teal"/><text x="20" y="60" font-size="30" fill="white">SVG</text></svg>
S
printf 'plain text\n' > t_txt.txt; printf '# Markdown\n\n*hi*\n' > t_md.md
printf '<h1>html</h1>' > t_html.html
printf '{\\rtf1\\ansi hello}' > t_rtf.rtf
printf 'WEBVTT\n\n00:00.000 --> 00:01.000\nhi\n' > s_vtt.vtt
printf '1\n00:00:00,000 --> 00:00:01,000\nhi\n' > s_srt.srt
rm -f sq.png i_src.png
