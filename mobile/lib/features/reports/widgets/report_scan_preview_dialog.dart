import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/app_theme.dart';

/// Rotates raw image bytes by the specified degrees (0, 90, 180, 270)
/// using Flutter's built-in [ui.PictureRecorder] and canvas.
Future<Uint8List> rotateImageBytes(Uint8List bytes, int degrees) async {
  final normalized = (degrees % 360 + 360) % 360;
  if (normalized == 0) return bytes;

  final codec = await ui.instantiateImageCodec(bytes);
  final frame = await codec.getNextFrame();
  final image = frame.image;

  final isSideways = normalized == 90 || normalized == 270;
  final targetWidth = isSideways ? image.height : image.width;
  final targetHeight = isSideways ? image.width : image.height;

  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder);

  canvas.translate(targetWidth / 2.0, targetHeight / 2.0);
  canvas.rotate(normalized * math.pi / 180.0);
  canvas.translate(-image.width / 2.0, -image.height / 2.0);
  canvas.drawImage(image, Offset.zero, Paint());

  final picture = recorder.endRecording();
  final rotatedImage = await picture.toImage(targetWidth, targetHeight);
  final byteData = await rotatedImage.toByteData(format: ui.ImageByteFormat.png);
  return byteData!.buffer.asUint8List();
}

/// A dialog allowing patients to inspect, frame, and rotate a captured
/// document scan before uploading it to OCR.
class ReportScanPreviewDialog extends StatefulWidget {
  const ReportScanPreviewDialog({
    super.key,
    required this.imageBytes,
    required this.filename,
  });

  final Uint8List imageBytes;
  final String filename;

  @override
  State<ReportScanPreviewDialog> createState() =>
      _ReportScanPreviewDialogState();
}

class _ReportScanPreviewDialogState extends State<ReportScanPreviewDialog> {
  int _rotation = 0;
  bool _processing = false;

  void _rotateClockwise() {
    HapticFeedback.lightImpact();
    setState(() {
      _rotation = (_rotation + 90) % 360;
    });
  }

  Future<void> _confirmScan() async {
    HapticFeedback.mediumImpact();
    setState(() => _processing = true);
    try {
      final processedBytes = await rotateImageBytes(
        widget.imageBytes,
        _rotation,
      );
      if (!mounted) return;
      Navigator.of(context).pop(processedBytes);
    } catch (_) {
      // Fallback to original bytes if canvas rotation fails
      if (!mounted) return;
      Navigator.of(context).pop(widget.imageBytes);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      backgroundColor: Colors.white,
      clipBehavior: Clip.antiAlias,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Top AppBar / Header
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 12, 12),
            child: Row(
              children: [
                const Icon(Icons.document_scanner_outlined, color: primary, size: 24),
                const SizedBox(width: 10),
                const Expanded(
                  child: Text(
                    'Review Document Scan',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                      color: ink,
                    ),
                  ),
                ),
                IconButton(
                  tooltip: 'Rotate 90°',
                  onPressed: _processing ? null : _rotateClockwise,
                  icon: const Icon(Icons.rotate_90_degrees_cw_outlined, color: ink),
                ),
                IconButton(
                  tooltip: 'Close',
                  onPressed: _processing ? null : () => Navigator.of(context).pop(null),
                  icon: const Icon(Icons.close, color: muted),
                ),
              ],
            ),
          ),
          const Divider(height: 1, color: line),

          // Document Viewfinder with Interactive Viewer
          Flexible(
            child: Container(
              color: const Color(0xFF1E242B),
              constraints: const BoxConstraints(maxHeight: 380),
              width: double.infinity,
              child: Stack(
                alignment: Alignment.center,
                children: [
                  // Image with Rotation Transform
                  InteractiveViewer(
                    maxScale: 4.0,
                    minScale: 0.8,
                    child: Center(
                      child: RotatedBox(
                        quarterTurns: _rotation ~/ 90,
                        child: Image.memory(
                          widget.imageBytes,
                          fit: BoxFit.contain,
                        ),
                      ),
                    ),
                  ),

                  // Framing Viewfinder Overlay
                  IgnorePointer(
                    child: Container(
                      margin: const EdgeInsets.all(20),
                      decoration: BoxDecoration(
                        border: Border.all(
                          color: Colors.white.withValues(alpha: 0.4),
                          width: 1.5,
                        ),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Stack(
                        children: [
                          // 4 Corner markers
                          Positioned(
                            top: 0,
                            left: 0,
                            child: _CornerMarker(corner: _Corner.topLeft),
                          ),
                          Positioned(
                            top: 0,
                            right: 0,
                            child: _CornerMarker(corner: _Corner.topRight),
                          ),
                          Positioned(
                            bottom: 0,
                            left: 0,
                            child: _CornerMarker(corner: _Corner.bottomLeft),
                          ),
                          Positioned(
                            bottom: 0,
                            right: 0,
                            child: _CornerMarker(corner: _Corner.bottomRight),
                          ),
                        ],
                      ),
                    ),
                  ),

                  // Processing overlay
                  if (_processing)
                    Container(
                      color: Colors.black45,
                      child: const Center(
                        child: CircularProgressIndicator(color: Colors.white),
                      ),
                    ),
                ],
              ),
            ),
          ),

          // Framing guidance & Quality checklist
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFBF8F5),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: line),
                  ),
                  child: const Row(
                    children: [
                      Icon(Icons.lightbulb_outline, size: 18, color: primary),
                      SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'Ensure patient name, test date, and lab values are in focus and free of glare.',
                          style: TextStyle(fontSize: 12, color: muted, height: 1.3),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 14),

                // Action buttons: Retake vs Proceed
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: _processing
                            ? null
                            : () {
                                HapticFeedback.lightImpact();
                                Navigator.of(context).pop(null);
                              },
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size(double.infinity, 48),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14),
                          ),
                          side: const BorderSide(color: line),
                        ),
                        child: const Text('Retake', style: TextStyle(color: ink)),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      flex: 2,
                      child: FilledButton.icon(
                        onPressed: _processing ? null : _confirmScan,
                        icon: const Icon(Icons.check, size: 18),
                        label: const Text('Use this scan'),
                        style: FilledButton.styleFrom(
                          minimumSize: const Size(double.infinity, 48),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

enum _Corner { topLeft, topRight, bottomLeft, bottomRight }

class _CornerMarker extends StatelessWidget {
  const _CornerMarker({required this.corner});

  final _Corner corner;

  @override
  Widget build(BuildContext context) {
    const size = 18.0;
    const stroke = 3.5;
    const color = primary;

    return CustomPaint(
      size: const Size(size, size),
      painter: _CornerPainter(corner: corner, stroke: stroke, color: color),
    );
  }
}

class _CornerPainter extends CustomPainter {
  _CornerPainter({
    required this.corner,
    required this.stroke,
    required this.color,
  });

  final _Corner corner;
  final double stroke;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = stroke
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;

    final path = Path();
    switch (corner) {
      case _Corner.topLeft:
        path.moveTo(0, size.height);
        path.lineTo(0, 0);
        path.lineTo(size.width, 0);
        break;
      case _Corner.topRight:
        path.moveTo(0, 0);
        path.lineTo(size.width, 0);
        path.lineTo(size.width, size.height);
        break;
      case _Corner.bottomLeft:
        path.moveTo(0, 0);
        path.lineTo(0, size.height);
        path.lineTo(size.width, size.height);
        break;
      case _Corner.bottomRight:
        path.moveTo(0, size.height);
        path.lineTo(size.width, size.height);
        path.lineTo(size.width, 0);
        break;
    }
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
