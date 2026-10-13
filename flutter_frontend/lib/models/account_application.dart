class AccountApplication {
  final Map<String, dynamic> data = <String, dynamic>{};
  final Map<String, String> documentPaths = <String, String>{};

  Map<String, dynamic> toJson() => Map<String, dynamic>.from(data);
}
