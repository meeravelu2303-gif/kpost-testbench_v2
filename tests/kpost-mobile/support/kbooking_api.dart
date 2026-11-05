import 'peer_api.dart';

/// KBooking's read-only endpoints, called the way the app calls them (lib/KBooking/apis/kbooking_api.dart;
/// ApiUrlConstants puts them under the same /v2/ base as every other KPost call in the bench's app copy).
/// Nothing here books, blocks a seat or pays: the bench never writes to KBooking (live Razorpay key, and
/// blockTicket / bookticket have no clean undo the bench has verified).
extension KBookingApi on ApiUser {
  /// The bus cities whose name matches [pattern], as the From field's suggestions ask for them
  /// (KBookingAPI.getCitySuggestionDetails: GET redbus/citysuggestion/<pattern>;
  /// CitySuggestionResponseModel `value[]` with `cityID`, `cityName`).
  Future<List<({String id, String name})>> busCities(String pattern) async {
    final response = await dio.get<Object>('redbus/citysuggestion/${Uri.encodeComponent(pattern)}');
    if (response.statusCode != 200) {
      throw StateError('the bus city list did not load: HTTP ${response.statusCode}');
    }
    return [
      for (final row in ApiUser.findMaps(response.data, (m) => m.containsKey('cityName')))
        if ('${row['cityName'] ?? ''}'.trim().isNotEmpty)
          (id: '${row['cityID'] ?? ''}', name: '${row['cityName']}'.trim()),
    ];
  }

  /// The cities buses run to from [sourceCityId], as the To field's suggestions ask for them
  /// (KBookingAPI.getDestinationDetails: POST redbus/destinations/ with DestinationRequestModel.toJson
  /// = {sourceCityID}; DestinationSuggestionResponseModel `value.cities[]` with `id`, `name`).
  Future<List<String>> busDestinations(String sourceCityId) async {
    final response =
        await dio.post<Object>('redbus/destinations/', data: {'sourceCityID': sourceCityId});
    if (response.statusCode != 200) {
      throw StateError('the bus destinations did not load: HTTP ${response.statusCode}');
    }
    return [
      for (final row in ApiUser.findMaps(
          response.data, (m) => m.containsKey('name') && m.containsKey('id')))
        if ('${row['name'] ?? ''}'.trim().isNotEmpty) '${row['name']}'.trim(),
    ];
  }

  /// This account's bus tickets, as My Tickets loads them (KBookingAPI.getTicket: GET redbus/getTicket/;
  /// GetTicketResponseModel `value[]`). Empty when the account has never booked.
  Future<List<Map<String, dynamic>>> busTickets() async {
    final response = await dio.get<Object>('redbus/getTicket/');
    if (response.statusCode != 200) {
      throw StateError('the ticket list did not load: HTTP ${response.statusCode}');
    }
    final data = response.data;
    final value = data is Map ? data['value'] : null;
    return value is List
        ? value.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
        : <Map<String, dynamic>>[];
  }
}
