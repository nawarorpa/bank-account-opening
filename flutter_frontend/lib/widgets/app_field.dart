import 'package:flutter/material.dart';

class AppField extends StatefulWidget {
  const AppField({
    super.key,
    required this.label,
    required this.onChanged,
    this.initialValue,
    this.required = false,
    this.readOnly = false,
    this.onTap,
    this.keyboardType,
    this.maxLines = 1,
  });

  final String label;
  final String? initialValue;
  final bool required;
  final bool readOnly;
  final VoidCallback? onTap;
  final TextInputType? keyboardType;
  final int maxLines;
  final ValueChanged<String> onChanged;

  @override
  State<AppField> createState() => _AppFieldState();
}

class _AppFieldState extends State<AppField> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(
      text: widget.initialValue ?? '',
    );
  }

  @override
  void didUpdateWidget(covariant AppField oldWidget) {
    super.didUpdateWidget(oldWidget);

    if (widget.initialValue != oldWidget.initialValue &&
        widget.initialValue != _controller.text) {
      _controller.text = widget.initialValue ?? '';
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: _controller,
      readOnly: widget.readOnly,
      onTap: widget.onTap,
      keyboardType: widget.keyboardType,
      maxLines: widget.maxLines,
      decoration: InputDecoration(
        labelText: widget.required
            ? '${widget.label} *'
            : widget.label,
        border: const OutlineInputBorder(),
      ),
      validator: widget.required
          ? (value) {
              if (value == null || value.trim().isEmpty) {
                return 'Required';
              }
              return null;
            }
          : null,
      onChanged: widget.onChanged,
    );
  }
}