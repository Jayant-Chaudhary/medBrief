import 'package:flutter/material.dart';

import '../app_theme.dart';

/// Lightweight shimmer effect for smooth skeleton loading screens.
class ShimmerLoading extends StatefulWidget {
  const ShimmerLoading({super.key, required this.child});

  final Widget child;

  @override
  State<ShimmerLoading> createState() => _ShimmerLoadingState();
}

class _ShimmerLoadingState extends State<ShimmerLoading>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1400),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        return ShaderMask(
          blendMode: BlendMode.srcATop,
          shaderCallback: (bounds) {
            final t = _controller.value;
            return LinearGradient(
              begin: const Alignment(-1.0, -0.3),
              end: const Alignment(1.0, 0.3),
              stops: [
                (t - 0.3).clamp(0.0, 1.0),
                t.clamp(0.0, 1.0),
                (t + 0.3).clamp(0.0, 1.0),
              ],
              colors: const [
                Color(0xFFECE7DE),
                Color(0xFFFAF8F5),
                Color(0xFFECE7DE),
              ],
            ).createShader(bounds);
          },
          child: child,
        );
      },
      child: widget.child,
    );
  }
}

/// A bone-colored rounded placeholder box for shimmer layouts.
class ShimmerBox extends StatelessWidget {
  const ShimmerBox({
    super.key,
    this.width,
    this.height = 16,
    this.borderRadius = 8,
  });

  final double? width;
  final double height;
  final double borderRadius;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: const Color(0xFFECE7DE),
        borderRadius: BorderRadius.circular(borderRadius),
      ),
    );
  }
}

/// Home tab skeleton layout that preserves the exact geometry of the dashboard.
class HomeSkeletonView extends StatelessWidget {
  const HomeSkeletonView({super.key});

  @override
  Widget build(BuildContext context) {
    return ShimmerLoading(
      child: ListView(
        physics: const NeverScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 100),
        children: [
          // Greeting & avatar
          Row(
            children: [
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    ShimmerBox(width: 190, height: 26, borderRadius: 8),
                    SizedBox(height: 8),
                    ShimmerBox(width: 110, height: 16, borderRadius: 6),
                  ],
                ),
              ),
              Container(
                width: 52,
                height: 52,
                decoration: const BoxDecoration(
                  color: Color(0xFFECE7DE),
                  shape: BoxShape.circle,
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),

          // Milestone card skeleton
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: line),
            ),
            child: const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    ShimmerBox(width: 130, height: 18, borderRadius: 6),
                    ShimmerBox(width: 80, height: 18, borderRadius: 6),
                  ],
                ),
                SizedBox(height: 14),
                ShimmerBox(height: 10, borderRadius: 5),
                SizedBox(height: 16),
                Row(
                  children: [
                    ShimmerBox(width: 36, height: 36, borderRadius: 10),
                    SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          ShimmerBox(width: 160, height: 15, borderRadius: 6),
                          SizedBox(height: 6),
                          ShimmerBox(height: 12, borderRadius: 4),
                        ],
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // Next appointment action card skeleton
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: line),
            ),
            child: const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ShimmerBox(width: 140, height: 16, borderRadius: 6),
                SizedBox(height: 12),
                ShimmerBox(width: 220, height: 20, borderRadius: 8),
                SizedBox(height: 16),
                ShimmerBox(height: 48, borderRadius: 14),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // Vitals sync card skeleton
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: line),
            ),
            child: const Row(
              children: [
                ShimmerBox(width: 44, height: 44, borderRadius: 12),
                SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      ShimmerBox(width: 120, height: 16, borderRadius: 6),
                      SizedBox(height: 6),
                      ShimmerBox(width: 180, height: 12, borderRadius: 4),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Appointments tab skeleton layout.
class AppointmentsSkeletonView extends StatelessWidget {
  const AppointmentsSkeletonView({super.key});

  @override
  Widget build(BuildContext context) {
    return ShimmerLoading(
      child: ListView(
        physics: const NeverScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 100),
        children: [
          // Filter pills skeleton
          Row(
            children: [
              ShimmerBox(width: 60, height: 36, borderRadius: 18),
              const SizedBox(width: 8),
              ShimmerBox(width: 90, height: 36, borderRadius: 18),
              const SizedBox(width: 8),
              ShimmerBox(width: 60, height: 36, borderRadius: 18),
            ],
          ),
          const SizedBox(height: 18),

          // 3 appointment card skeletons
          for (int i = 0; i < 3; i++) ...[
            Container(
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: line),
              ),
              child: const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      ShimmerBox(width: 100, height: 14, borderRadius: 6),
                      ShimmerBox(width: 70, height: 22, borderRadius: 11),
                    ],
                  ),
                  SizedBox(height: 12),
                  ShimmerBox(width: 200, height: 18, borderRadius: 6),
                  SizedBox(height: 8),
                  ShimmerBox(width: 140, height: 14, borderRadius: 6),
                  SizedBox(height: 14),
                  Row(
                    children: [
                      Expanded(child: ShimmerBox(height: 40, borderRadius: 12)),
                      SizedBox(width: 10),
                      Expanded(child: ShimmerBox(height: 40, borderRadius: 12)),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
          ],
        ],
      ),
    );
  }
}

/// Reports tab skeleton layout.
class ReportsSkeletonView extends StatelessWidget {
  const ReportsSkeletonView({super.key});

  @override
  Widget build(BuildContext context) {
    return ShimmerLoading(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          for (int i = 0; i < 3; i++) ...[
            Container(
              margin: const EdgeInsets.only(bottom: 12),
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: line),
              ),
              child: const Row(
                children: [
                  ShimmerBox(width: 46, height: 46, borderRadius: 12),
                  SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        ShimmerBox(width: 160, height: 16, borderRadius: 6),
                        SizedBox(height: 6),
                        ShimmerBox(width: 100, height: 12, borderRadius: 4),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
